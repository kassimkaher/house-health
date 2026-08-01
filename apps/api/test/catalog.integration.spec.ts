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

describe("catalog admin API (integration)", () => {
  let ctx: TestAppContext;
  let http: ReturnType<TestAppContext["app"]["getHttpServer"]>;
  let prisma: PrismaService;
  let managerToken: string;
  let reviewerToken: string;
  let userToken: string;

  async function makeUser(email: string, roles: string[]): Promise<string> {
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: { email, passwordHash, roles: roles as never, status: "active", emailVerifiedAt: new Date() },
    });
    const res = await request(http).post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    ctx = await createTestApp(AppModule);
    http = ctx.app.getHttpServer();
    prisma = ctx.app.get(PrismaService);
    const redis = ctx.app.get<Redis>(REDIS);
    await truncateAllTables(prisma);
    await redis.flushdb();

    await prisma.nutrientDefinition.createMany({
      data: [
        { key: "energy_kcal", nameAr: "طاقة", nameEn: "Energy", unit: "kcal", isCore: true, displayOrder: 1 },
        { key: "protein_g", nameAr: "بروتين", nameEn: "Protein", unit: "g", isCore: true, displayOrder: 2 },
      ],
    });

    managerToken = await makeUser("manager@example.com", ["data_manager"]);
    reviewerToken = await makeUser("reviewer@example.com", ["nutrition_reviewer"]);
    userToken = await makeUser("plain@example.com", ["user"]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const asManager = () => ({ Authorization: `Bearer ${managerToken}` });
  const asReviewer = () => ({ Authorization: `Bearer ${reviewerToken}` });
  const asUser = () => ({ Authorization: `Bearer ${userToken}` });

  let foodId: string;

  it("enforces the RBAC matrix on catalog routes", async () => {
    // Plain users cannot even read admin catalog.
    await request(http).get("/api/v1/admin/catalog/foods").set(asUser()).expect(403);
    // Reviewers read but cannot write.
    await request(http).get("/api/v1/admin/catalog/foods").set(asReviewer()).expect(200);
    await request(http)
      .post("/api/v1/admin/catalog/foods")
      .set(asReviewer())
      .send({ foodType: "generic_food", nameAr: "خبز", nameEn: "Bread" })
      .expect(403);
    // Managers hold foods.* — transition passes the guard and 404s on a
    // nonexistent food rather than 403ing.
    await request(http)
      .post("/api/v1/admin/catalog/foods/00000000-0000-0000-0000-000000000000/transition")
      .set(asManager())
      .send({ to: "verified" })
      .expect(404);
    // Reviewers cannot transition arbitrary review states they lack perms for:
    // write-only surfaces (nutrients) stay forbidden.
    await request(http)
      .post("/api/v1/admin/catalog/foods/00000000-0000-0000-0000-000000000000/nutrients")
      .set(asReviewer())
      .send({ nutrients: [{ key: "energy_kcal", valuePer100g: 1 }] })
      .expect(403);
  });

  it("creates a food with a generated slug and Arabic normalization", async () => {
    const res = await request(http)
      .post("/api/v1/admin/catalog/foods")
      .set(asManager())
      .send({
        foodType: "generic_food",
        nameAr: "صمون عراقي",
        nameEn: "Iraqi Samoon",
        preparationState: "baked",
        marketTags: ["IQ"],
        defaultPortionGrams: 90,
      })
      .expect(201);
    foodId = res.body.id;
    expect(res.body.slug).toBe("iraqi-samoon");
    expect(res.body.reviewStatus).toBe("imported");
    expect(res.body.publicationStatus).toBe("draft");

    const norm = await prisma.$queryRaw<Array<{ n: string }>>`SELECT name_ar_norm AS n FROM foods WHERE id = ${foodId}::uuid`;
    expect(norm[0]?.n).toBe("صمون عراقي");
  });

  it("sets nutrients and rebuilds the denormalized map", async () => {
    await request(http)
      .post(`/api/v1/admin/catalog/foods/${foodId}/nutrients`)
      .set(asManager())
      .send({ nutrients: [{ key: "energy_kcal", valuePer100g: 270 }, { key: "protein_g", valuePer100g: 9 }] })
      .expect(200);
    const res = await request(http).get(`/api/v1/admin/catalog/foods/${foodId}`).set(asManager()).expect(200);
    expect(res.body.nutrientsDenorm).toEqual({ energy_kcal: 270, protein_g: 9 });

    await request(http)
      .post(`/api/v1/admin/catalog/foods/${foodId}/nutrients`)
      .set(asManager())
      .send({ nutrients: [{ key: "unknown_thing", valuePer100g: 1 }] })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe(ERROR_CODES.CATALOG_UNKNOWN_NUTRIENT));
  });

  it("adds aliases (deduped on normalized form) and portions", async () => {
    await request(http)
      .post(`/api/v1/admin/catalog/foods/${foodId}/aliases`)
      .set(asManager())
      .send({ alias: "صمونة", kind: "iraqi_dialect", locale: "ar-IQ" })
      .expect(200);
    // Normalized duplicate (ta marbuta vs ha) is a silent no-op.
    const res = await request(http)
      .post(`/api/v1/admin/catalog/foods/${foodId}/aliases`)
      .set(asManager())
      .send({ alias: "صمونه", kind: "iraqi_dialect" })
      .expect(200);
    expect(res.body.aliases).toHaveLength(1);

    await request(http)
      .post(`/api/v1/admin/catalog/foods/${foodId}/portions`)
      .set(asManager())
      .send({ labelAr: "صمونة واحدة", labelEn: "1 samoon", grams: 90, isDefault: true, locale: "ar-IQ" })
      .expect(200);
  });

  it("enforces optimistic concurrency via If-Match", async () => {
    const current = await request(http).get(`/api/v1/admin/catalog/foods/${foodId}`).set(asManager()).expect(200);
    const version = current.body.rowVersion;

    await request(http)
      .patch(`/api/v1/admin/catalog/foods/${foodId}`)
      .set(asManager())
      .set("If-Match", String(version))
      .send({ descriptionEn: "Traditional Iraqi bread" })
      .expect(200);

    // Stale version → 409.
    const conflict = await request(http)
      .patch(`/api/v1/admin/catalog/foods/${foodId}`)
      .set(asManager())
      .set("If-Match", String(version))
      .send({ descriptionEn: "conflicting edit" })
      .expect(409);
    expect(conflict.body.code).toBe(ERROR_CODES.CONFLICT_VERSION);

    await request(http)
      .patch(`/api/v1/admin/catalog/foods/${foodId}`)
      .set(asManager())
      .send({ descriptionEn: "no header" })
      .expect(400);
  });

  it("walks the review state machine and rejects illegal jumps", async () => {
    // imported → verified is illegal.
    const bad = await request(http)
      .post(`/api/v1/admin/catalog/foods/${foodId}/transition`)
      .set(asReviewer())
      .send({ to: "verified" })
      .expect(422);
    expect(bad.body.code).toBe(ERROR_CODES.CATALOG_INVALID_TRANSITION);

    for (const to of ["normalized", "needs_review", "verified"]) {
      await request(http)
        .post(`/api/v1/admin/catalog/foods/${foodId}/transition`)
        .set(asReviewer())
        .send({ to, notes: `moving to ${to}` })
        .expect(200);
    }
    const res = await request(http).get(`/api/v1/admin/catalog/foods/${foodId}`).set(asReviewer()).expect(200);
    expect(res.body.reviewStatus).toBe("verified");
    expect(res.body.reviewedById).toBeDefined();
  });

  it("drops verified foods back to needs_review on substantive edits", async () => {
    const current = await request(http).get(`/api/v1/admin/catalog/foods/${foodId}`).set(asManager()).expect(200);
    const res = await request(http)
      .patch(`/api/v1/admin/catalog/foods/${foodId}`)
      .set(asManager())
      .set("If-Match", String(current.body.rowVersion))
      .send({ nameEn: "Iraqi Samoon Bread" })
      .expect(200);
    expect(res.body.reviewStatus).toBe("needs_review");
  });

  it("scopes barcode uniqueness to active foods and frees on reject", async () => {
    await request(http)
      .post(`/api/v1/admin/catalog/foods/${foodId}/barcodes`)
      .set(asManager())
      .send({ code: "6291041500213" })
      .expect(200);

    const other = await request(http)
      .post("/api/v1/admin/catalog/foods")
      .set(asManager())
      .send({ foodType: "branded_product", nameAr: "منتج", nameEn: "Competing Product" })
      .expect(201);

    // Same barcode on another food → conflict.
    const taken = await request(http)
      .post(`/api/v1/admin/catalog/foods/${other.body.id}/barcodes`)
      .set(asManager())
      .send({ code: "6291041500213" })
      .expect(409);
    expect(taken.body.code).toBe(ERROR_CODES.CATALOG_BARCODE_TAKEN);

    // Rejecting the holder frees the barcode (food is already needs_review
    // after the substantive-edit test above).
    await request(http)
      .post(`/api/v1/admin/catalog/foods/${foodId}/transition`)
      .set(asReviewer())
      .send({ to: "rejected", notes: "duplicate entry" })
      .expect(200);

    await request(http)
      .post(`/api/v1/admin/catalog/foods/${other.body.id}/barcodes`)
      .set(asManager())
      .send({ code: "6291041500213" })
      .expect(200);
  });

  it("searches editorial foods with Arabic normalization and typo tolerance", async () => {
    const res = await request(http)
      .get("/api/v1/admin/catalog/foods")
      .set(asManager())
      .query({ q: "صمونه" }) // ta marbuta variant + dialect alias
      .expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items.some((f: { id: string }) => f.id === foodId)).toBe(true);
  });

  it("manages taxonomy (categories, brands, nutrient definitions)", async () => {
    const cat = await request(http)
      .post("/api/v1/admin/catalog/categories")
      .set(asManager())
      .send({ slug: "bread", nameAr: "الخبز", nameEn: "Bread" })
      .expect(201);
    await request(http)
      .post("/api/v1/admin/catalog/categories")
      .set(asManager())
      .send({ slug: "bread", nameAr: "خبز", nameEn: "Bread 2" })
      .expect(409);

    await request(http)
      .post("/api/v1/admin/catalog/brands")
      .set(asManager())
      .send({ slug: "al-durra", nameEn: "Al Durra", countryCode: "iq" })
      .expect(201);

    await request(http)
      .post("/api/v1/admin/catalog/nutrients")
      .set(asManager())
      .send({ key: "calcium_mg", nameAr: "الكالسيوم", nameEn: "Calcium", unit: "mg", displayOrder: 11 })
      .expect(200);

    expect(cat.body.slug).toBe("bread");
    const audit = await prisma.auditLog.findMany({ where: { action: "category.create" } });
    expect(audit).toHaveLength(1);
  });
});
