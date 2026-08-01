import "reflect-metadata";
import request from "supertest";
import { REDIS } from "@hh/auth";
import { ERROR_CODES } from "@hh/contracts";
import { createTestApp, truncateAllTables, type TestAppContext } from "@hh/testing";
import type Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/infra/prisma.service";

jest.setTimeout(120_000); // argon2id at 64 MiB makes each login deliberately slow

const PASSWORD = "s3cure-password";
const NEW_PASSWORD = "an0ther-password";

describe("auth API (integration)", () => {
  let ctx: TestAppContext;
  let http: ReturnType<TestAppContext["app"]["getHttpServer"]>;
  let prisma: PrismaService;
  let redis: Redis;

  beforeAll(async () => {
    ctx = await createTestApp(AppModule);
    http = ctx.app.getHttpServer();
    prisma = ctx.app.get(PrismaService);
    redis = ctx.app.get<Redis>(REDIS);
    await truncateAllTables(prisma);
    await redis.flushdb();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function registerAndVerify(email: string, password: string): Promise<void> {
    await request(http).post("/api/v1/auth/register").send({ email, password }).expect(201);
    const token = ctx.email.lastTokenFor(email);
    expect(token).toBeDefined();
    await request(http).post("/api/v1/auth/verify-email").send({ token }).expect(200);
  }

  async function login(
    email: string,
    password: string,
    device?: { deviceName?: string; deviceId?: string },
  ): Promise<{ accessToken: string; refreshToken: string; user: { id: string } }> {
    const res = await request(http)
      .post("/api/v1/auth/login")
      .send({ email, password, ...device })
      .expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.accessExpiresIn).toEqual(expect.any(Number));
    return res.body;
  }

  describe("register → verify → login → refresh → sessions journey", () => {
    const email = "journey@example.com";

    it("registers with a generic 201 and emails a verification token", async () => {
      const res = await request(http)
        .post("/api/v1/auth/register")
        .send({ email, password: PASSWORD })
        .expect(201);
      expect(res.body.message).toEqual(expect.any(String));
      expect(ctx.email.lastTokenFor(email)).toBeDefined();
    });

    it("returns the same generic 201 for an existing email (no enumeration)", async () => {
      const before = ctx.email.sent.length;
      const res = await request(http)
        .post("/api/v1/auth/register")
        .send({ email, password: "different-pass-1" })
        .expect(201);
      expect(res.body.message).toEqual(expect.any(String));
      expect(ctx.email.sent.length).toBe(before); // no second verification mail
    });

    it("rejects login while pending_verification with a generic 401", async () => {
      const res = await request(http)
        .post("/api/v1/auth/login")
        .send({ email, password: PASSWORD })
        .expect(401);
      expect(res.body.code).toBe(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    });

    it("verifies email with the mailed single-use token", async () => {
      const token = ctx.email.lastTokenFor(email);
      await request(http).post("/api/v1/auth/verify-email").send({ token }).expect(200);
      // Single use: the same token is now invalid.
      const again = await request(http)
        .post("/api/v1/auth/verify-email")
        .send({ token })
        .expect(400);
      expect(again.body.code).toBe(ERROR_CODES.AUTH_TOKEN_INVALID);
    });

    it("logs in, serves /me, rotates refresh, and detects reuse", async () => {
      const first = await login(email, PASSWORD, { deviceName: "Phone" });

      const me = await request(http)
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${first.accessToken}`)
        .expect(200);
      expect(me.body.email).toBe(email);
      expect(me.body.emailVerified).toBe(true);
      expect(me.body.roles).toEqual(["user"]);
      expect(me.body.status).toBe("active");

      // Rotate: old refresh dies, new pair works.
      const rotated = await request(http)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      expect(rotated.body.refreshToken).not.toBe(first.refreshToken);
      await request(http)
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${rotated.body.accessToken}`)
        .expect(200);

      // Reusing the rotated-out token revokes the whole family + session.
      const reuse = await request(http)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      expect(reuse.body.code).toBe(ERROR_CODES.AUTH_TOKEN_REUSED);

      // The "new" refresh token from the rotation is dead too...
      const dead = await request(http)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
      expect([ERROR_CODES.AUTH_SESSION_REVOKED, ERROR_CODES.AUTH_TOKEN_REUSED]).toContain(
        dead.body.code,
      );

      // ...and so is the session's access token (Redis denylist).
      const revokedAccess = await request(http)
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${rotated.body.accessToken}`)
        .expect(401);
      expect(revokedAccess.body.code).toBe(ERROR_CODES.AUTH_SESSION_REVOKED);
    });

    it("lists devices, flags the current one, and revokes without IDOR", async () => {
      const phone = await login(email, PASSWORD, { deviceName: "Phone", deviceId: "dev-phone" });
      const laptop = await login(email, PASSWORD, { deviceName: "Laptop", deviceId: "dev-laptop" });

      const list = await request(http)
        .get("/api/v1/auth/sessions")
        .set("Authorization", `Bearer ${laptop.accessToken}`)
        .expect(200);
      expect(list.body.length).toBeGreaterThanOrEqual(2);
      const current = list.body.find((s: { current: boolean }) => s.current);
      expect(current.deviceName).toBe("Laptop");
      const other = list.body.find((s: { deviceName: string }) => s.deviceName === "Phone");
      expect(other.current).toBe(false);

      // Revoke the phone session from the laptop.
      await request(http)
        .delete(`/api/v1/auth/sessions/${other.id}`)
        .set("Authorization", `Bearer ${laptop.accessToken}`)
        .expect(204);

      // The phone's access token is rejected immediately.
      const phoneMe = await request(http)
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${phone.accessToken}`)
        .expect(401);
      expect(phoneMe.body.code).toBe(ERROR_CODES.AUTH_SESSION_REVOKED);

      // Revoking again (or any non-owned/unknown id) is a 404, not a 403.
      await request(http)
        .delete(`/api/v1/auth/sessions/${other.id}`)
        .set("Authorization", `Bearer ${laptop.accessToken}`)
        .expect(404);
      await request(http)
        .delete("/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000")
        .set("Authorization", `Bearer ${laptop.accessToken}`)
        .expect(404);
      await request(http)
        .delete("/api/v1/auth/sessions/not-a-uuid")
        .set("Authorization", `Bearer ${laptop.accessToken}`)
        .expect(404);
    });

    it("another user cannot revoke someone else's session (404)", async () => {
      const victimSessions = await prisma.session.findMany({
        where: { revokedAt: null, user: { email } },
        select: { id: true },
      });
      expect(victimSessions.length).toBeGreaterThanOrEqual(1);

      const attackerEmail = "attacker@example.com";
      await registerAndVerify(attackerEmail, PASSWORD);
      const attacker = await login(attackerEmail, PASSWORD);
      const targetSession = victimSessions[0];
      expect(targetSession).toBeDefined();
      await request(http)
        .delete(`/api/v1/auth/sessions/${(targetSession as { id: string }).id}`)
        .set("Authorization", `Bearer ${attacker.accessToken}`)
        .expect(404);
    });

    it("logout revokes the current session", async () => {
      const session = await login(email, PASSWORD, { deviceName: "Tablet" });
      await request(http)
        .post("/api/v1/auth/logout")
        .set("Authorization", `Bearer ${session.accessToken}`)
        .expect(204);
      const after = await request(http)
        .get("/api/v1/me")
        .set("Authorization", `Bearer ${session.accessToken}`)
        .expect(401);
      expect(after.body.code).toBe(ERROR_CODES.AUTH_SESSION_REVOKED);
      await request(http)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: session.refreshToken })
        .expect(401);
    });
  });

  describe("password forgot/reset", () => {
    const email = "reset-me@example.com";

    it("resets the password and revokes every session", async () => {
      await registerAndVerify(email, PASSWORD);
      const sessionA = await login(email, PASSWORD, { deviceName: "A" });
      const sessionB = await login(email, PASSWORD, { deviceName: "B" });

      await request(http)
        .post("/api/v1/auth/password/forgot")
        .send({ email })
        .expect(202);
      const resetToken = ctx.email.lastTokenFor(email);
      expect(resetToken).toBeDefined();

      await request(http)
        .post("/api/v1/auth/password/reset")
        .send({ token: resetToken, password: NEW_PASSWORD })
        .expect(200);

      // All sessions are dead: access tokens and refresh tokens alike.
      for (const session of [sessionA, sessionB]) {
        const meRes = await request(http)
          .get("/api/v1/me")
          .set("Authorization", `Bearer ${session.accessToken}`)
          .expect(401);
        expect(meRes.body.code).toBe(ERROR_CODES.AUTH_SESSION_REVOKED);
        await request(http)
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: session.refreshToken })
          .expect(401);
      }

      // The reset token is single-use.
      await request(http)
        .post("/api/v1/auth/password/reset")
        .send({ token: resetToken, password: "yet-an0ther-pass" })
        .expect(400);

      // Old password no longer works; the new one does.
      await request(http)
        .post("/api/v1/auth/login")
        .send({ email, password: PASSWORD })
        .expect(401);
      await login(email, NEW_PASSWORD);

      // Password reset and session revocations were audited.
      const audit = await prisma.auditLog.findMany({
        where: { action: { in: ["auth.password.reset", "auth.session.revoke"] } },
      });
      expect(audit.some((a) => a.action === "auth.password.reset")).toBe(true);
      expect(audit.some((a) => a.action === "auth.session.revoke")).toBe(true);
    });

    it("responds 202 for unknown emails without sending anything", async () => {
      const before = ctx.email.sent.length;
      await request(http)
        .post("/api/v1/auth/password/forgot")
        .send({ email: "nobody@example.com" })
        .expect(202);
      expect(ctx.email.sent.length).toBe(before);
    });
  });

  describe("account lockout", () => {
    const email = "lockme@example.com";

    it("locks the account after 5 failures and unlocks after the backoff", async () => {
      await registerAndVerify(email, PASSWORD);

      for (let i = 0; i < 5; i += 1) {
        const res = await request(http)
          .post("/api/v1/auth/login")
          .send({ email, password: "wrong-password-1" })
          .expect(401);
        expect(res.body.code).toBe(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      // Even the correct password is refused while locked.
      const locked = await request(http)
        .post("/api/v1/auth/login")
        .send({ email, password: PASSWORD })
        .expect(429);
      expect(locked.body.code).toBe(ERROR_CODES.AUTH_ACCOUNT_LOCKED);

      // First lock is 2^1 = 2s; wait it out, then login succeeds and resets.
      await new Promise((resolve) => setTimeout(resolve, 2_200));
      await login(email, PASSWORD);
      expect(await redis.exists(`login:fail:${email}`)).toBe(0);
    });
  });

  describe("validation & routing", () => {
    it("returns 422 with field-level errors for invalid payloads", async () => {
      const res = await request(http)
        .post("/api/v1/auth/register")
        .send({ email: "not-an-email", password: "short" })
        .expect(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      const paths = (res.body.fields as Array<{ path: string; message: string }>).map(
        (f) => f.path,
      );
      expect(paths).toEqual(expect.arrayContaining(["email", "password"]));
    });

    it("returns 422 for a missing body on login", async () => {
      const res = await request(http).post("/api/v1/auth/login").send({}).expect(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it("returns 404 for unknown routes", async () => {
      await request(http).get("/api/v1/definitely-not-here").expect(404);
    });

    it("requires a bearer token on protected routes", async () => {
      const noToken = await request(http).get("/api/v1/me").expect(401);
      expect(noToken.body.code).toBe(ERROR_CODES.AUTH_UNAUTHORIZED);
      const badToken = await request(http)
        .get("/api/v1/me")
        .set("Authorization", "Bearer garbage.token.here")
        .expect(401);
      expect(badToken.body.code).toBe(ERROR_CODES.AUTH_TOKEN_EXPIRED);
    });

    it("health liveness stays public", async () => {
      await request(http).get("/health/live").expect(200);
    });
  });

  describe("Google OIDC when unconfigured", () => {
    it("returns a machine-readable 503 from /auth/google/start", async () => {
      const res = await request(http).get("/api/v1/auth/google/start").expect(503);
      expect(res.body.code).toBe(ERROR_CODES.AUTH_OIDC_NOT_CONFIGURED);
    });

    it("returns a machine-readable 503 from /auth/google/callback", async () => {
      const res = await request(http)
        .get("/api/v1/auth/google/callback?code=x&state=y")
        .expect(503);
      expect(res.body.code).toBe(ERROR_CODES.AUTH_OIDC_NOT_CONFIGURED);
    });
  });
});
