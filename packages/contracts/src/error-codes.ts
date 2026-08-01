/**
 * Machine-readable error-code registry. Every non-2xx API response carries one
 * of these in its body as `code`; clients switch on the code, never on the
 * human-readable message.
 */
export const ERROR_CODES = {
  /** Unknown email, wrong password, or non-active account — always generic. */
  AUTH_INVALID_CREDENTIALS: "auth.invalid_credentials",
  /** Too many failed logins for this account; retry after the lock expires. */
  AUTH_ACCOUNT_LOCKED: "auth.account_locked",
  /** Access/refresh/action token expired. */
  AUTH_TOKEN_EXPIRED: "auth.token_expired",
  /** Token unknown, malformed, or already consumed (verify/reset tokens). */
  AUTH_TOKEN_INVALID: "auth.token_invalid",
  /** A rotated-out refresh token was presented — the whole family is revoked. */
  AUTH_TOKEN_REUSED: "auth.token_reused",
  /** The session behind this token has been revoked (logout/remote revoke). */
  AUTH_SESSION_REVOKED: "auth.session_revoked",
  /** Missing/invalid Authorization header on a protected route. */
  AUTH_UNAUTHORIZED: "auth.unauthorized",
  /** Authenticated but lacking the required permission. */
  AUTH_FORBIDDEN: "auth.forbidden",
  /** Google OIDC endpoints called while GOOGLE_* env trio is not configured. */
  AUTH_OIDC_NOT_CONFIGURED: "auth.oidc_not_configured",
  /** OIDC state missing/expired or code exchange failed. */
  AUTH_OIDC_EXCHANGE_FAILED: "auth.oidc_exchange_failed",
  /** Google email is unverified and collides with an existing account. */
  AUTH_OIDC_EMAIL_CONFLICT: "auth.oidc_email_conflict",
  /** Request body/query failed schema validation; see `fields`. */
  VALIDATION_FAILED: "validation.failed",
  /** IP/route rate limit exceeded (throttler). */
  RATE_LIMITED: "rate_limited",
  /** Resource does not exist or is not visible to the caller. */
  NOT_FOUND: "not_found",
  /** Unhandled server error. */
  INTERNAL: "internal_error",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Field-level validation problem, as returned with `validation.failed`. */
export interface ValidationFieldError {
  path: string;
  message: string;
}
