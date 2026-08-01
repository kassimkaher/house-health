import { computeNextFireAt } from "./schedule";

describe("computeNextFireAt", () => {
  it("fires later today when the time is still ahead (Baghdad, no DST)", () => {
    const next = computeNextFireAt(
      { timeLocal: "20:00", daysOfWeek: [], timezone: "Asia/Baghdad" },
      new Date("2026-08-01T10:00:00Z"), // 13:00 Baghdad (+03)
    );
    expect(next?.toISOString()).toBe("2026-08-01T17:00:00.000Z"); // 20:00 +03
  });

  it("rolls to tomorrow when today's time has passed", () => {
    const next = computeNextFireAt(
      { timeLocal: "08:00", daysOfWeek: [], timezone: "Asia/Baghdad" },
      new Date("2026-08-01T10:00:00Z"),
    );
    expect(next?.toISOString()).toBe("2026-08-02T05:00:00.000Z");
  });

  it("respects daysOfWeek (weekly weigh-in on Fridays)", () => {
    // 2026-08-01 is a Saturday; next Friday is 2026-08-07.
    const next = computeNextFireAt(
      { timeLocal: "09:00", daysOfWeek: [5], timezone: "Asia/Baghdad" },
      new Date("2026-08-01T10:00:00Z"),
    );
    expect(next?.toISOString()).toBe("2026-08-07T06:00:00.000Z");
  });

  it("keeps local wall-clock time across spring-forward (Berlin)", () => {
    // DST starts 2026-03-29 in Europe/Berlin: 02:00 → 03:00 (+01 → +02).
    const before = computeNextFireAt(
      { timeLocal: "08:00", daysOfWeek: [], timezone: "Europe/Berlin" },
      new Date("2026-03-28T09:00:00Z"), // fires 28th? no—08:00 CET passed; fires 29th
    );
    // 29th 08:00 is CEST (+02) → 06:00Z, not 07:00Z.
    expect(before?.toISOString()).toBe("2026-03-29T06:00:00.000Z");
  });

  it("resolves nonexistent local times forward (02:30 in the DST gap)", () => {
    const next = computeNextFireAt(
      { timeLocal: "02:30", daysOfWeek: [], timezone: "Europe/Berlin" },
      new Date("2026-03-28T23:00:00Z"), // just before the gap night
    );
    // 02:30 on Mar 29 doesn't exist; Luxon resolves within the shifted hour.
    expect(next).not.toBeNull();
    const utcHour = next!.getUTCHours();
    expect([1, 2]).toContain(utcHour); // resolved around the gap, never crashes
  });

  it("keeps local wall-clock time across fall-back (Berlin)", () => {
    // DST ends 2026-10-25: +02 → +01.
    const next = computeNextFireAt(
      { timeLocal: "08:00", daysOfWeek: [], timezone: "Europe/Berlin" },
      new Date("2026-10-25T05:00:00Z"),
    );
    expect(next?.toISOString()).toBe("2026-10-25T07:00:00.000Z"); // 08:00 CET (+01)
  });

  it("handles one-time schedules and exhausts them", () => {
    const schedule = { timeLocal: "12:00", daysOfWeek: [], oneTimeOn: "2026-08-05", timezone: "Asia/Baghdad" };
    expect(computeNextFireAt(schedule, new Date("2026-08-01T00:00:00Z"))?.toISOString()).toBe(
      "2026-08-05T09:00:00.000Z",
    );
    expect(computeNextFireAt(schedule, new Date("2026-08-06T00:00:00Z"))).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(() =>
      computeNextFireAt({ timeLocal: "25:00", daysOfWeek: [], timezone: "Asia/Baghdad" }, new Date()),
    ).toThrow(/timeLocal/);
    expect(() =>
      computeNextFireAt({ timeLocal: "08:00", daysOfWeek: [], timezone: "Not/AZone" }, new Date()),
    ).toThrow(/timezone/);
  });
});
