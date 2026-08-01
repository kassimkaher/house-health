import { LOCKOUT_CAP_SEC, LOCKOUT_THRESHOLD, lockoutSeconds } from "./lockout";

describe("lockoutSeconds", () => {
  it("does not lock below the threshold", () => {
    expect(lockoutSeconds(0)).toBe(0);
    expect(lockoutSeconds(1)).toBe(0);
    expect(lockoutSeconds(LOCKOUT_THRESHOLD - 1)).toBe(0);
  });

  it("starts at 2s on the 5th failure and doubles", () => {
    expect(lockoutSeconds(5)).toBe(2);
    expect(lockoutSeconds(6)).toBe(4);
    expect(lockoutSeconds(7)).toBe(8);
    expect(lockoutSeconds(8)).toBe(16);
    expect(lockoutSeconds(12)).toBe(256);
    expect(lockoutSeconds(13)).toBe(512);
  });

  it("caps at 900s (15 min)", () => {
    expect(lockoutSeconds(14)).toBe(LOCKOUT_CAP_SEC);
    expect(lockoutSeconds(15)).toBe(LOCKOUT_CAP_SEC);
    expect(lockoutSeconds(100)).toBe(LOCKOUT_CAP_SEC);
    expect(lockoutSeconds(10_000)).toBe(LOCKOUT_CAP_SEC);
  });
});
