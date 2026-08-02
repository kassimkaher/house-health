import { z } from "zod";

/**
 * Password policy: at least 8 characters and must mix letters and digits.
 * Kept deliberately simple — length is the primary defense; argon2id does the
 * heavy lifting server-side.
 */
export const passwordSchema = z
  .string()
  .min(8, "must be at least 8 characters")
  .max(128, "must be at most 128 characters")
  .regex(/[A-Za-z]/, "must contain at least one letter")
  .regex(/[0-9]/, "must contain at least one digit");

const emailSchema = z.string().trim().email("must be a valid email address").max(320);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(512),
});
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  deviceName: z.string().trim().min(1).max(120).optional(),
  deviceId: z.string().trim().min(1).max(120).optional(),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  // Optional: cookie-mode clients (?client=web) rely on the hh_refresh cookie
  // instead of sending the token in the body.
  refreshToken: z.string().min(1).max(512).optional(),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  password: passwordSchema,
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

// ---------------------------------------------------------------------------
// Response views
// ---------------------------------------------------------------------------

export const sessionViewSchema = z.object({
  id: z.string().uuid(),
  deviceName: z.string().nullable(),
  deviceId: z.string().nullable(),
  userAgent: z.string().nullable(),
  ipCreated: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  current: z.boolean(),
});
export type SessionView = z.infer<typeof sessionViewSchema>;

export const authTokensViewSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  accessExpiresIn: z.number().int().positive(),
  refreshToken: z.string(),
});
export type AuthTokensView = z.infer<typeof authTokensViewSchema>;

export const userViewSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  emailVerified: z.boolean(),
  roles: z.array(z.string()),
  status: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.string(),
});
export type UserView = z.infer<typeof userViewSchema>;
