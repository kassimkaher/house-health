/** Failures before locking kicks in. */
export const LOCKOUT_THRESHOLD = 5;
/** Upper bound for a single lock, seconds (15 min). */
export const LOCKOUT_CAP_SEC = 900;
/** Sliding TTL of the failure counter itself, seconds. */
export const LOCKOUT_COUNTER_TTL_SEC = 900;

/**
 * Exponential per-account lockout: below the threshold no lock; from the
 * threshold on, 2^n seconds where n counts failures past the threshold
 * (5 fails → 2s, 6 → 4s, 7 → 8s, ...), capped at 900s.
 */
export function lockoutSeconds(failCount: number): number {
  if (failCount < LOCKOUT_THRESHOLD) {
    return 0;
  }
  const exponent = failCount - LOCKOUT_THRESHOLD + 1;
  // Guard the shift against absurd counters before Math.min can help.
  if (exponent >= 10) {
    return LOCKOUT_CAP_SEC;
  }
  return Math.min(2 ** exponent, LOCKOUT_CAP_SEC);
}

export function loginFailKey(email: string): string {
  return `login:fail:${email.toLowerCase()}`;
}

export function loginLockKey(email: string): string {
  return `login:lock:${email.toLowerCase()}`;
}
