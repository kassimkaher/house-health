import { randomBytes } from "node:crypto";

/**
 * Cookie-based auth for admin-web. Mobile/API clients keep using bearer
 * tokens from the same login/refresh endpoints — this is additive, selected
 * by the caller passing `?client=web`.
 */
export const ACCESS_COOKIE = "hh_access";
export const REFRESH_COOKIE = "hh_refresh";
export const CSRF_COOKIE = "hh_csrf";
export const CSRF_HEADER = "x-csrf-token";

export interface CookieResponseLike {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options?: Record<string, unknown>): void;
}

function baseOptions(secure: boolean, maxAgeMs: number): Record<string, unknown> {
  return { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: maxAgeMs };
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/** Sets access/refresh as httpOnly cookies and a readable CSRF cookie. */
export function setAuthCookies(
  res: CookieResponseLike,
  tokens: { accessToken: string; refreshToken: string; accessExpiresIn: number },
  opts: { secure: boolean; refreshTtlDays: number },
): string {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, baseOptions(opts.secure, tokens.accessExpiresIn * 1000));
  res.cookie(
    REFRESH_COOKIE,
    tokens.refreshToken,
    baseOptions(opts.secure, opts.refreshTtlDays * 86_400_000),
  );
  const csrf = generateCsrfToken();
  // CSRF cookie is intentionally NOT httpOnly — the browser JS must read it
  // and echo it back in the X-CSRF-Token header (double-submit pattern).
  res.cookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure: opts.secure,
    sameSite: "lax",
    path: "/",
    maxAge: opts.refreshTtlDays * 86_400_000,
  });
  return csrf;
}

export function clearAuthCookies(res: CookieResponseLike): void {
  res.clearCookie(ACCESS_COOKIE, { path: "/" });
  res.clearCookie(REFRESH_COOKIE, { path: "/" });
  res.clearCookie(CSRF_COOKIE, { path: "/" });
}
