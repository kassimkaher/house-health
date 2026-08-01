import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque 256-bit refresh token, base64url (43 chars). Only its sha256 hex hash
 * is ever persisted.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex digest — used for refresh tokens and auth action tokens alike. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Redis denylist key for a revoked session id. */
export function sessionDenyKey(sessionId: string): string {
  return `sess:deny:${sessionId}`;
}
