import { z } from "zod";
import { mealSlotSchema } from "./consumption";

export const reminderTypeSchema = z.enum(["meal_slot", "meal_group", "hydration", "weigh_in", "custom"]);

const timeLocalSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const upsertReminderSchema = z
  .object({
    type: reminderTypeSchema,
    mealSlot: mealSlotSchema.optional(),
    mealGroupId: z.string().uuid().optional(),
    customText: z.string().trim().min(1).max(200).optional(),
    timeLocal: timeLocalSchema,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    oneTimeOn: isoDate.optional(),
    isEnabled: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.type !== "custom" || !!v.customText, {
    message: "customText required for custom reminders",
    path: ["customText"],
  })
  .refine((v) => v.type !== "meal_slot" || !!v.mealSlot, {
    message: "mealSlot required for meal_slot reminders",
    path: ["mealSlot"],
  });
export type UpsertReminderDto = z.infer<typeof upsertReminderSchema>;
