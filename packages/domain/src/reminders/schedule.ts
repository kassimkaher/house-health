import { DateTime } from "luxon";

/**
 * DST-safe next-occurrence computation. The local wall-clock time is resolved
 * through the user's IANA zone at computation time, so "08:00" stays 08:00
 * local across DST transitions; nonexistent local times (spring-forward gap)
 * resolve forward per Luxon's semantics.
 */
export interface ReminderSchedule {
  /** "HH:mm" local wall-clock time. */
  timeLocal: string;
  /** 0=Sunday … 6=Saturday. Empty with no oneTimeOn ⇒ every day. */
  daysOfWeek: number[];
  /** ISO date for one-time reminders; overrides daysOfWeek. */
  oneTimeOn?: string | null | undefined;
  /** IANA zone, e.g. "Asia/Baghdad". */
  timezone: string;
}

function parseTime(timeLocal: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeLocal);
  if (!match) throw new Error(`invalid timeLocal: ${timeLocal}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Luxon weekday (1=Mon..7=Sun) → our 0=Sun..6=Sat. */
function toDow(luxonWeekday: number): number {
  return luxonWeekday % 7;
}

/**
 * The next UTC instant this schedule fires strictly after `after`.
 * Returns null for exhausted one-time schedules.
 */
export function computeNextFireAt(schedule: ReminderSchedule, after: Date): Date | null {
  const { hour, minute } = parseTime(schedule.timeLocal);
  const zone = schedule.timezone;
  const afterDt = DateTime.fromJSDate(after, { zone });
  if (!afterDt.isValid) throw new Error(`invalid timezone: ${zone}`);

  if (schedule.oneTimeOn) {
    const fire = DateTime.fromISO(schedule.oneTimeOn, { zone }).set({
      hour,
      minute,
      second: 0,
      millisecond: 0,
    });
    if (!fire.isValid) throw new Error(`invalid oneTimeOn: ${schedule.oneTimeOn}`);
    return fire > afterDt ? fire.toUTC().toJSDate() : null;
  }

  const days = schedule.daysOfWeek.length > 0 ? new Set(schedule.daysOfWeek) : null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = afterDt
      .plus({ days: offset })
      .set({ hour, minute, second: 0, millisecond: 0 });
    if (candidate <= afterDt) continue;
    if (days === null || days.has(toDow(candidate.weekday))) {
      return candidate.toUTC().toJSDate();
    }
  }
  return null; // unreachable for valid inputs
}
