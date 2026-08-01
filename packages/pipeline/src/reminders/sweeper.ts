import type { PrismaClient } from "@hh/database";
import { prisma as defaultPrisma } from "@hh/database";
import { computeNextFireAt } from "@hh/domain";
import type { PushPayload, PushPort } from "@hh/notifications";

export interface DueDispatch {
  deliveryId: string;
  reminderId: string;
  userId: string;
  scheduledFor: Date;
}

/**
 * Reminder scheduling core (runs in the worker every minute):
 *  1. sweep(): lock due reminders (FOR UPDATE SKIP LOCKED), create delivery
 *     rows (unique (reminder, scheduledFor) ⇒ idempotent under double sweeps)
 *     and advance next_fire_at in the SAME transaction.
 *  2. dispatch(): send via the push port and mark the delivery row.
 */
export class ReminderSweeper {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly push?: PushPort,
  ) {}

  async sweep(now: Date = new Date(), limit = 500): Promise<DueDispatch[]> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<
        Array<{ id: string; user_id: string; next_fire_at: Date; time_local: string; days_of_week: number[]; one_time_on: Date | null }>
      >`
        SELECT id, user_id, next_fire_at, time_local, days_of_week, one_time_on
        FROM reminders
        WHERE is_enabled AND deleted_at IS NULL AND next_fire_at IS NOT NULL AND next_fire_at <= ${now}
        ORDER BY next_fire_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;

      const dispatches: DueDispatch[] = [];
      for (const row of due) {
        const delivery = await tx.reminderDelivery.upsert({
          where: { reminderId_scheduledFor: { reminderId: row.id, scheduledFor: row.next_fire_at } },
          update: {},
          create: { reminderId: row.id, scheduledFor: row.next_fire_at, status: "queued" },
        });
        // Advance to the next occurrence using the user's CURRENT timezone.
        const profile = await tx.userProfile.findUnique({ where: { userId: row.user_id } });
        const next = computeNextFireAt(
          {
            timeLocal: row.time_local,
            daysOfWeek: row.days_of_week,
            oneTimeOn: row.one_time_on ? row.one_time_on.toISOString().slice(0, 10) : null,
            timezone: profile?.timezone ?? "Asia/Baghdad",
          },
          now,
        );
        await tx.reminder.update({
          where: { id: row.id },
          data: { nextFireAt: next, ...(next === null ? { isEnabled: false } : {}) },
        });
        if (delivery.status === "queued") {
          dispatches.push({
            deliveryId: delivery.id,
            reminderId: row.id,
            userId: row.user_id,
            scheduledFor: row.next_fire_at,
          });
        }
      }
      return dispatches;
    });
  }

  async dispatch(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.reminderDelivery.findUnique({
      where: { id: deliveryId },
      include: { reminder: true },
    });
    if (!delivery || delivery.status === "sent" || delivery.status === "cancelled") return;
    if (!delivery.reminder.isEnabled && delivery.status === "scheduled") {
      await this.prisma.reminderDelivery.update({
        where: { id: deliveryId },
        data: { status: "skipped" },
      });
      return;
    }
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId: delivery.reminder.userId },
      select: { token: true },
    });
    const payload = this.payloadFor(delivery.reminder.type, delivery.reminder.customText);
    try {
      const provider = this.push;
      if (!provider) throw new Error("no push provider configured");
      const result = await provider.sendPush(
        tokens.map((t) => t.token),
        payload,
      );
      await this.prisma.reminderDelivery.update({
        where: { id: deliveryId },
        data:
          result.failed > 0 && result.delivered === 0
            ? { status: "failed", failReason: "provider reported failure", provider: provider.name }
            : { status: "sent", sentAt: new Date(), provider: provider.name },
      });
    } catch (err) {
      await this.prisma.reminderDelivery.update({
        where: { id: deliveryId },
        data: { status: "failed", failReason: (err as Error).message },
      });
      throw err;
    }
  }

  private payloadFor(type: string, customText: string | null): PushPayload {
    switch (type) {
      case "meal_slot":
        return { title: "تذكير الوجبة", body: "حان وقت تسجيل وجبتك" };
      case "meal_group":
        return { title: "تذكير الوجبة", body: "وجبتك المحفوظة جاهزة للتسجيل" };
      case "hydration":
        return { title: "تذكير الماء", body: "لا تنسَ شرب الماء" };
      case "weigh_in":
        return { title: "تذكير الوزن", body: "حان وقت قياس وزنك" };
      default:
        return { title: "تذكير", body: customText ?? "لديك تذكير" };
    }
  }
}
