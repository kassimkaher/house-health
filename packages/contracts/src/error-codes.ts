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
  /** Calorie estimate requested but profile lacks sex/birthDate/height/weight. */
  CALC_PROFILE_INCOMPLETE: "calc.profile_incomplete",
  /** Calculation inputs rejected by the engine's guard rails; see `fields`. */
  CALC_INVALID_INPUTS: "calc.invalid_inputs",
  /** No active calculation policy row exists for the requested equation. */
  CALC_NO_ACTIVE_POLICY: "calc.no_active_policy",
  /** If-Match row version does not match — concurrent admin edit detected. */
  CONFLICT_VERSION: "conflict.version",
  /** Requested review-state transition is not allowed from the current state. */
  CATALOG_INVALID_TRANSITION: "catalog.invalid_transition",
  /** Barcode already actively assigned to another food. */
  CATALOG_BARCODE_TAKEN: "catalog.barcode_taken",
  /** Slug already in use. */
  CATALOG_SLUG_TAKEN: "catalog.slug_taken",
  /** Nutrient key does not exist in nutrient_definitions. */
  CATALOG_UNKNOWN_NUTRIENT: "catalog.unknown_nutrient",
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
