import { randomUUID } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  REDIS,
  generateRefreshToken,
  sessionDenyKey,
  sha256Hex,
  signAccessToken,
} from "@hh/auth";
import { APP_CONFIG, type AppConfig } from "@hh/config";
import { ERROR_CODES, type AuthTokensView } from "@hh/contracts";
import type Redis from "ioredis";
import { PrismaService } from "../infra/prisma.service";
import { AuditService } from "./audit.service";

export interface TokenSubject {
  id: string;
  roles: string[];
}

export interface RotationResult {
  tokens: AuthTokensView;
  userId: string;
  sessionId: string;
}

@Injectable()
export class TokenService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private refreshExpiry(from: Date): Date {
    return new Date(from.getTime() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  }

  /** Denylist TTL slightly outlives the longest possible access token. */
  private denyTtlSec(): number {
    return this.config.accessTokenTtlSec + 60;
  }

  /** Issue a fresh access token + a brand-new refresh-token family for a session. */
  async issueForNewSession(user: TokenSubject, sessionId: string): Promise<AuthTokensView> {
    const now = new Date();
    const familyId = randomUUID();
    const refreshToken = generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        sessionId,
        familyId,
        tokenHash: sha256Hex(refreshToken),
        parentId: null,
        expiresAt: this.refreshExpiry(now),
      },
    });
    const accessToken = await signAccessToken({
      privateKeyPem: this.config.jwtPrivateKeyPem,
      ttlSec: this.config.accessTokenTtlSec,
      userId: user.id,
      sessionId,
      roles: user.roles,
    });
    return {
      accessToken,
      accessExpiresIn: this.config.accessTokenTtlSec,
      refreshToken,
    };
  }

  /**
   * Rotate a refresh token. Single atomic conditional UPDATE marks the token
   * used; zero affected rows on an existing token means reuse — the whole
   * family and its session are revoked and the sid is denylisted.
   */
  async rotate(rawRefreshToken: string): Promise<RotationResult> {
    const tokenHash = sha256Hex(rawRefreshToken);
    const now = new Date();

    const updated = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (updated.count === 0) {
      const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
      if (!existing) {
        throw new UnauthorizedException({ code: ERROR_CODES.AUTH_TOKEN_INVALID });
      }
      if (existing.usedAt !== null || existing.revokedAt !== null) {
        await this.revokeFamily(existing.familyId, existing.sessionId, "refresh_token_reuse");
        throw new UnauthorizedException({ code: ERROR_CODES.AUTH_TOKEN_REUSED });
      }
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_TOKEN_EXPIRED });
    }

    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: { include: { user: true } } },
    });
    if (!current) {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_TOKEN_INVALID });
    }
    const session = current.session;
    const user = session.user;
    if (session.revokedAt !== null || user.status !== "active" || user.deletedAt !== null) {
      await this.revokeFamily(current.familyId, session.id, "refresh_on_revoked_session");
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_SESSION_REVOKED });
    }

    const refreshToken = generateRefreshToken();
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          sessionId: session.id,
          familyId: current.familyId,
          tokenHash: sha256Hex(refreshToken),
          parentId: current.id,
          expiresAt: this.refreshExpiry(now),
        },
      }),
      this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      }),
    ]);

    const accessToken = await signAccessToken({
      privateKeyPem: this.config.jwtPrivateKeyPem,
      ttlSec: this.config.accessTokenTtlSec,
      userId: user.id,
      sessionId: session.id,
      roles: user.roles as string[],
    });

    return {
      tokens: {
        accessToken,
        accessExpiresIn: this.config.accessTokenTtlSec,
        refreshToken,
      },
      userId: user.id,
      sessionId: session.id,
    };
  }

  /**
   * Revoke every refresh token in a family, revoke its session, and denylist
   * the session id so outstanding access tokens die immediately.
   */
  async revokeFamily(familyId: string, sessionId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    await this.denySession(sessionId);
    await this.audit.append({
      action: "auth.session.revoke",
      entityType: "session",
      entityId: sessionId,
      after: { reason },
    });
  }

  /** Add a session id to the Redis access-token denylist. */
  async denySession(sessionId: string): Promise<void> {
    await this.redis.set(sessionDenyKey(sessionId), "1", "EX", this.denyTtlSec());
  }
}
