import { generateKeyPairSync } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { sha256Hex, verifyAccessToken } from "@hh/auth";
import { type AppConfig } from "@hh/config";
import { ERROR_CODES } from "@hh/contracts";
import type Redis from "ioredis";
import { type PrismaService } from "../infra/prisma.service";
import { type AuditService } from "./audit.service";
import { TokenService } from "./token.service";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

const config: AppConfig = {
  nodeEnv: "test",
  apiPort: 0,
  databaseUrl: "postgres://unused",
  redisUrl: "redis://unused",
  appBaseUrl: "http://localhost:3100",
  adminWebOrigin: "http://localhost:3002",
  corsOrigins: [],
  jwtPrivateKeyPem: privatePem,
  jwtPublicKeyPem: publicPem,
  accessTokenTtlSec: 600,
  refreshTokenTtlDays: 30,
  google: null,
  s3: { endpoint: "http://127.0.0.1:9100", accessKey: "x", secretKey: "x", bucketPrefix: "hh-test" },
  otelEnabled: false,
  otelExporterOtlpEndpoint: null,
  errorTrackingDsn: null,
};

interface MockPrisma {
  refreshToken: {
    updateMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  session: {
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makeMocks(): { prisma: MockPrisma; redis: { set: jest.Mock }; audit: { append: jest.Mock } } {
  const prisma: MockPrisma = {
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    },
    session: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockImplementation((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  return {
    prisma,
    redis: { set: jest.fn().mockResolvedValue("OK") },
    audit: { append: jest.fn().mockResolvedValue(undefined) },
  };
}

function makeService(mocks: ReturnType<typeof makeMocks>): TokenService {
  return new TokenService(
    config,
    mocks.prisma as unknown as PrismaService,
    mocks.redis as unknown as Redis,
    mocks.audit as unknown as AuditService,
  );
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toThrow(UnauthorizedException);
  try {
    await promise;
  } catch (err) {
    expect((err as UnauthorizedException).getResponse()).toMatchObject({ code });
  }
}

describe("TokenService.rotate", () => {
  it("rejects a completely unknown token as invalid", async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);
    await expectCode(service.rotate("no-such-token"), ERROR_CODES.AUTH_TOKEN_INVALID);
    expect(mocks.audit.append).not.toHaveBeenCalled();
  });

  it("rejects an expired-but-unused token without revoking the family", async () => {
    const mocks = makeMocks();
    mocks.prisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt-1",
      sessionId: "sess-1",
      familyId: "fam-1",
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    const service = makeService(mocks);
    await expectCode(service.rotate("expired-token"), ERROR_CODES.AUTH_TOKEN_EXPIRED);
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });

  it("treats a second use as reuse: revokes family + session and denylists the sid", async () => {
    const mocks = makeMocks();
    mocks.prisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt-1",
      sessionId: "sess-1",
      familyId: "fam-1",
      usedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000_000),
    });
    const service = makeService(mocks);
    await expectCode(service.rotate("reused-token"), ERROR_CODES.AUTH_TOKEN_REUSED);

    expect(mocks.prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { familyId: "fam-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(mocks.prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sess-1", revokedAt: null } }),
    );
    expect(mocks.redis.set).toHaveBeenCalledWith(
      "sess:deny:sess-1",
      "1",
      "EX",
      config.accessTokenTtlSec + 60,
    );
    expect(mocks.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.session.revoke", entityId: "sess-1" }),
    );
  });

  it("rotates a live token: marks it used, chains parentId, keeps the family", async () => {
    const mocks = makeMocks();
    const raw = "live-refresh-token";
    mocks.prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt-1",
      sessionId: "sess-1",
      familyId: "fam-1",
      usedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000_000),
      session: {
        id: "sess-1",
        revokedAt: null,
        user: { id: "user-1", roles: ["user"], status: "active", deletedAt: null },
      },
    });
    const service = makeService(mocks);
    const result = await service.rotate(raw);

    // The conditional UPDATE targeted exactly the presented token.
    expect(mocks.prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tokenHash: sha256Hex(raw), usedAt: null, revokedAt: null }),
        data: { usedAt: expect.any(Date) },
      }),
    );
    // New token: same family, parent chain, different hash.
    const createArg = mocks.prisma.refreshToken.create.mock.calls[0]?.[0] as {
      data: { familyId: string; parentId: string; tokenHash: string; sessionId: string };
    };
    expect(createArg.data.familyId).toBe("fam-1");
    expect(createArg.data.parentId).toBe("rt-1");
    expect(createArg.data.sessionId).toBe("sess-1");
    expect(createArg.data.tokenHash).toBe(sha256Hex(result.tokens.refreshToken));
    expect(result.tokens.refreshToken).not.toBe(raw);
    // Session activity is bumped.
    expect(mocks.prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sess-1" }, data: { lastSeenAt: expect.any(Date) } }),
    );
    // Access token verifies and carries the right claims.
    const claims = await verifyAccessToken(result.tokens.accessToken, publicPem);
    expect(claims).toEqual({ sub: "user-1", sid: "sess-1", roles: ["user"] });
    expect(result.tokens.accessExpiresIn).toBe(600);
  });

  it("rejects rotation on a revoked session and kills the family", async () => {
    const mocks = makeMocks();
    mocks.prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.prisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt-1",
      sessionId: "sess-1",
      familyId: "fam-1",
      usedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000_000),
      session: {
        id: "sess-1",
        revokedAt: new Date(),
        user: { id: "user-1", roles: ["user"], status: "active", deletedAt: null },
      },
    });
    const service = makeService(mocks);
    await expectCode(service.rotate("token-on-dead-session"), ERROR_CODES.AUTH_SESSION_REVOKED);
    expect(mocks.redis.set).toHaveBeenCalledWith("sess:deny:sess-1", "1", "EX", expect.any(Number));
  });
});
