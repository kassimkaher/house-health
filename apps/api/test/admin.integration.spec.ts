import "reflect-metadata";
import request from "supertest";
import { REDIS, hashPassword } from "@hh/auth";
import { ERROR_CODES } from "@hh/contracts";
import { createTestApp, truncateAllTables, type TestAppContext } from "@hh/testing";
import type Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/infra/prisma.service";

jest.setTimeout(120_000);

const PASSWORD = "s3cure-password";

describe("admin ops API (integration)", () => {
  let ctx: TestAppContext;
  let http: ReturnType<TestAppContext["app"]["getHttpServer"]>;
  let prisma: PrismaService;
  let superToken: string;
  let supportToken: string;
  let plainToken: string;
  let plainUserId: string;
  let superUserId: string;

  async function makeUser(email: string, roles: string[]): Promise<{ token: string; id: string }> {
    const passwordHash = await hashPassword(PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, roles: roles as never, status: "active", emailVerifiedAt: new Date() },
    });
    const res = await request(http).post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
    return { token: res.body.accessToken, id: user.id };
  }

  beforeAll(async () => {
    ctx = await createTestApp(AppModule);
    http = ctx.app.getHttpServer();
    prisma = ctx.app.get(PrismaService);
    const redis = ctx.app.get<Redis>(REDIS);
    await truncateAllTables(prisma);
    await redis.flushdb();

    const superAdmin = await makeUser("super@example.com", ["super_admin"]);
    superToken = superAdmin.token;
    superUserId = superAdmin.id;
    const support = await makeUser("support@example.com", ["support_admin"]);
    supportToken = support.token;
    const plain = await makeUser("plain-admin-test@example.com", ["user"]);
    plainToken = plain.token;
    plainUserId = plain.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const asSuper = () => ({ Authorization: `Bearer ${superToken}` });
  const asSupport = () => ({ Authorization: `Bearer ${supportToken}` });
  const asPlain = () => ({ Authorization: `Bearer ${plainToken}` });

  it("enforces the RBAC matrix on user management", async () => {
    await request(http).get("/api/v1/admin/users").set(asPlain()).expect(403);
    await request(http).get("/api/v1/admin/users").set(asSupport()).expect(200);
    // support_admin can suspend but not change roles.
    await request(http)
      .post(`/api/v1/admin/users/${plainUserId}/roles`)
      .set(asSupport())
      .send({ roles: ["data_manager"] })
      .expect(403);
    await request(http).post(`/api/v1/admin/users/${plainUserId}/roles`).set(asSuper()).send({ roles: ["data_manager"] }).expect(200);
  });

  it("suspends a user and immediately revokes their sessions", async () => {
    const target = await makeUser("suspend-target@example.com", ["user"]);
    // Confirm the token works before suspension.
    await request(http).get("/api/v1/me").set({ Authorization: `Bearer ${target.token}` }).expect(200);

    await request(http)
      .post(`/api/v1/admin/users/${target.id}/suspend`)
      .set(asSupport())
      .send({ reason: "suspicious activity" })
      .expect(200);

    const res = await request(http).get("/api/v1/me").set({ Authorization: `Bearer ${target.token}` }).expect(401);
    expect(res.body.code).toBe(ERROR_CODES.AUTH_SESSION_REVOKED);

    await request(http).post(`/api/v1/admin/users/${target.id}/reactivate`).set(asSupport()).expect(200);
  });

  it("blocks self-suspension and self-demotion (super_admin lockout guard)", async () => {
    await request(http)
      .post(`/api/v1/admin/users/${superUserId}/suspend`)
      .set(asSuper())
      .send({ reason: "test" })
      .expect(400);
    await request(http)
      .post(`/api/v1/admin/users/${superUserId}/roles`)
      .set(asSuper())
      .send({ roles: ["user"] })
      .expect(400);
  });

  it("soft-deletes with an auditable retention path (never a hard delete)", async () => {
    const target = await makeUser("delete-target@example.com", ["user"]);
    await request(http).post(`/api/v1/admin/users/${target.id}/delete`).set(asSuper()).expect(204);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe("deleted");
    expect(row.deletedAt).not.toBeNull();
    expect(row.email).toBeTruthy(); // row still exists — retained, not erased
  });

  it("finds duplicate foods and merges them, archiving the source", async () => {
    const manager = await makeUser("dup-manager@example.com", ["data_manager"]);
    const a = await request(http)
      .post("/api/v1/admin/catalog/foods")
      .set({ Authorization: `Bearer ${manager.token}` })
      .send({ foodType: "generic_food", nameAr: "خبز عربي", nameEn: "Arabic Bread" })
      .expect(201);
    const b = await request(http)
      .post("/api/v1/admin/catalog/foods")
      .set({ Authorization: `Bearer ${manager.token}` })
      .send({ foodType: "generic_food", nameAr: "خبز عربي", nameEn: "Arabic Bread Duplicate" })
      .expect(201);
    await request(http)
      .post(`/api/v1/admin/catalog/foods/${b.body.id}/aliases`)
      .set({ Authorization: `Bearer ${manager.token}` })
      .send({ alias: "خبز شامي", kind: "colloquial_other" })
      .expect(200);

    const dupes = await request(http)
      .get("/api/v1/admin/catalog/duplicates")
      .set(asSuper())
      .query({ threshold: 0.5 })
      .expect(200);
    expect(dupes.body.some((d: { foodIdA: string; foodIdB: string }) => [d.foodIdA, d.foodIdB].includes(a.body.id))).toBe(true);

    const merged = await request(http)
      .post("/api/v1/admin/catalog/duplicates/merge")
      .set(asSuper())
      .send({ sourceFoodId: b.body.id, targetFoodId: a.body.id, notes: "same product" })
      .expect(200);
    expect(merged.body.aliases.some((al: { alias: string }) => al.alias === "خبز شامي")).toBe(true);

    const source = await request(http).get(`/api/v1/admin/catalog/foods/${b.body.id}`).set(asSuper()).expect(200);
    expect(source.body.reviewStatus).toBe("archived");
    expect(source.body.reviewNotes).toContain("merged_into");
  });

  it("manages calculation policy versions, keeping only one active per key", async () => {
    const v1 = await request(http)
      .post("/api/v1/admin/calc-policies")
      .set(asSuper())
      .send({ key: "test_policy", config: { a: 1 }, activate: true })
      .expect(201);
    const v2 = await request(http)
      .post("/api/v1/admin/calc-policies")
      .set(asSuper())
      .send({ key: "test_policy", config: { a: 2 }, activate: true })
      .expect(201);
    expect(v2.body.version).toBe(v1.body.version + 1);

    const list = await request(http).get("/api/v1/admin/calc-policies").set(asSuper()).expect(200);
    const testPolicies = list.body.filter((p: { key: string }) => p.key === "test_policy");
    expect(testPolicies.filter((p: { isActive: boolean }) => p.isActive)).toHaveLength(1);
  });

  it("reports queue summaries and system overview to permitted roles only", async () => {
    await request(http).get("/api/v1/admin/jobs/summary").set(asPlain()).expect(403);
    const jobs = await request(http).get("/api/v1/admin/jobs/summary").set(asSuper()).expect(200);
    expect(jobs.body.queues.map((q: { name: string }) => q.name)).toEqual(
      expect.arrayContaining(["imports", "catalog", "reminders"]),
    );

    const overview = await request(http).get("/api/v1/admin/system/overview").set(asSuper()).expect(200);
    expect(overview.body.users.total).toBeGreaterThan(0);
    expect(overview.body.catalog).toBeDefined();
  });

  it("exposes the audit log with cursor pagination, newest first", async () => {
    const res = await request(http).get("/api/v1/admin/audit").set(asSuper()).query({ limit: 5 }).expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].createdAt >= res.body.items[res.body.items.length - 1].createdAt).toBe(true);
    await request(http).get("/api/v1/admin/audit").set(asSupport()).expect(200); // support_admin has audit.read
    await request(http).get("/api/v1/admin/audit").set(asPlain()).expect(403);
  });

  it("serves an authenticated liveness/readiness check", async () => {
    await request(http).get("/health/live").expect(200);
    const ready = await request(http).get("/health/ready").expect(200);
    expect(ready.body.checks.postgres.status).toBe("ok");
    expect(ready.body.checks.redis.status).toBe("ok");
  });

  describe("cookie-based auth + CSRF (admin-web)", () => {
    it("issues httpOnly cookies for ?client=web and enforces CSRF on mutations", async () => {
      const email = "cookie-admin@example.com";
      const passwordHash = await hashPassword(PASSWORD);
      await prisma.user.create({
        data: { email, passwordHash, roles: ["support_admin"], status: "active", emailVerifiedAt: new Date() },
      });
      const login = await request(http)
        .post("/api/v1/auth/login?client=web")
        .send({ email, password: PASSWORD })
        .expect(200);
      const setCookie = login.headers["set-cookie"] as unknown as string[];
      expect(setCookie.some((c) => c.startsWith("hh_access="))).toBe(true);
      expect(setCookie.some((c) => c.startsWith("hh_csrf="))).toBe(true);

      const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
      const csrfCookie = setCookie.find((c) => c.startsWith("hh_csrf="))!.split(";")[0]!.split("=")[1]!;

      // GET works via cookie alone (no CSRF needed for safe methods).
      await request(http).get("/api/v1/admin/users").set("Cookie", cookieHeader).expect(200);

      // Mutating request without the CSRF header is rejected.
      const noCsrf = await request(http)
        .post("/api/v1/admin/users/00000000-0000-0000-0000-000000000000/reactivate")
        .set("Cookie", cookieHeader)
        .expect(403);
      expect(noCsrf.body.code).toBe(ERROR_CODES.AUTH_FORBIDDEN);

      // With the matching CSRF header it passes the guard (404s on the fake id, not 403).
      await request(http)
        .post("/api/v1/admin/users/00000000-0000-0000-0000-000000000000/reactivate")
        .set("Cookie", cookieHeader)
        .set("x-csrf-token", csrfCookie)
        .expect(404);

      // Bearer-token requests remain exempt from CSRF entirely.
      await request(http)
        .post(`/api/v1/admin/users/${plainUserId}/reactivate`)
        .set(asSuper())
        .expect(200);
    });
  });
});
