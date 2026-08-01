import "reflect-metadata";
import request from "supertest";
import { REDIS } from "@hh/auth";
import { prisma as pipelinePrisma } from "@hh/database";
import { LogPushProvider } from "@hh/notifications";
import { ReminderSweeper } from "@hh/pipeline";
import { createTestApp, truncateAllTables, type TestAppContext } from "@hh/testing";
import type Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/infra/prisma.service";

jest.setTimeout(120_000);

const PASSWORD = "s3cure-password";

describe("reminders (integration)", () => {
  let ctx: TestAppContext;
  let http: ReturnType<TestAppContext["app"]["getHttpServer"]>;
  let prisma: PrismaService;
  let accessToken: string;
  let userId: string;
  const authed = () => ({ Authorization: `Bearer ${accessToken}` });

  beforeAll(async () => {
    ctx = await createTestApp(AppModule);
    http = ctx.app.getHttpServer();
    prisma = ctx.app.get(PrismaService);
    const redis = ctx.app.get<Redis>(REDIS);
    await truncateAllTables(prisma);
    await redis.flushdb();

    const email = "reminder-user@example.com";
    await request(http).post("/api/v1/auth/register").send({ email, password: PASSWORD }).expect(201);
    await request(http)
      .post("/api/v1/auth/verify-email")
      .send({ token: ctx.email.lastTokenFor(email) })
      .expect(200);
    const login = await request(http).post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
    accessToken = login.body.accessToken;
    userId = (await prisma.user.findFirstOrThrow({ where: { email } })).id;
  });

  afterAll(async () => {
    await pipelinePrisma.$disconnect();
    await ctx.app.close();
  });

  it("creates a recurring reminder with a computed next occurrence", async () => {
    const res = await request(http)
      .post("/api/v1/reminders")
      .set(authed())
      .send({ type: "meal_slot", mealSlot: "breakfast", timeLocal: "08:00", daysOfWeek: [] })
      .expect(201);
    expect(res.body.nextFireAt).toEqual(expect.any(String));
    // Next 08:00 Asia/Baghdad (+03) is 05:00Z.
    expect(new Date(res.body.nextFireAt).getUTCHours()).toBe(5);
  });

  it("validates reminder payloads (custom without text rejected)", async () => {
    await request(http)
      .post("/api/v1/reminders")
      .set(authed())
      .send({ type: "custom", timeLocal: "10:00", daysOfWeek: [1] })
      .expect(422);
    await request(http)
      .post("/api/v1/reminders")
      .set(authed())
      .send({ type: "custom", timeLocal: "27:00", customText: "hi", daysOfWeek: [] })
      .expect(422);
  });

  it("disabling clears scheduling", async () => {
    const created = await request(http)
      .post("/api/v1/reminders")
      .set(authed())
      .send({ type: "weigh_in", timeLocal: "07:30", daysOfWeek: [5] })
      .expect(201);
    const updated = await request(http)
      .patch(`/api/v1/reminders/${created.body.id}`)
      .set(authed())
      .send({ type: "weigh_in", timeLocal: "07:30", daysOfWeek: [5], isEnabled: false })
      .expect(200);
    expect(updated.body.nextFireAt).toBeNull();
  });

  it("sweeps due reminders exactly once and dispatches via the log provider", async () => {
    // A reminder that became due a minute ago.
    const due = await prisma.reminder.create({
      data: {
        userId,
        type: "hydration",
        timeLocal: "12:00",
        daysOfWeek: [],
        isEnabled: true,
        nextFireAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.pushToken.create({ data: { userId, token: "test-device-token", platform: "android" } });

    const sweeper = new ReminderSweeper(pipelinePrisma, new LogPushProvider());
    const first = await sweeper.sweep();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ reminderId: due.id });

    // Idempotency: a second sweep finds nothing new for the same occurrence.
    const second = await sweeper.sweep();
    expect(second).toHaveLength(0);

    // next_fire_at advanced into the future.
    const reloaded = await prisma.reminder.findUniqueOrThrow({ where: { id: due.id } });
    expect(reloaded.nextFireAt!.getTime()).toBeGreaterThan(Date.now());

    // Dispatch marks the delivery sent through the log provider.
    await sweeper.dispatch(first[0]!.deliveryId);
    const delivery = await prisma.reminderDelivery.findUniqueOrThrow({ where: { id: first[0]!.deliveryId } });
    expect(delivery).toMatchObject({ status: "sent", provider: "log" });
    expect(delivery.sentAt).not.toBeNull();

    // Re-dispatch is a no-op (idempotent).
    await sweeper.dispatch(first[0]!.deliveryId);
    const again = await prisma.reminderDelivery.findUniqueOrThrow({ where: { id: first[0]!.deliveryId } });
    expect(again.sentAt?.getTime()).toBe(delivery.sentAt?.getTime());
  });

  it("exposes the delivery log to the owner only", async () => {
    const reminder = await prisma.reminder.findFirstOrThrow({ where: { userId, type: "hydration" } });
    const res = await request(http).get(`/api/v1/reminders/${reminder.id}/deliveries`).set(authed()).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("sent");
  });

  it("soft-deletes reminders and stops scheduling", async () => {
    const created = await request(http)
      .post("/api/v1/reminders")
      .set(authed())
      .send({ type: "custom", customText: "اشرب جاي", timeLocal: "16:00", daysOfWeek: [] })
      .expect(201);
    await request(http).delete(`/api/v1/reminders/${created.body.id}`).set(authed()).expect(204);
    const list = await request(http).get("/api/v1/reminders").set(authed()).expect(200);
    expect(list.body.some((r: { id: string }) => r.id === created.body.id)).toBe(false);
  });
});
