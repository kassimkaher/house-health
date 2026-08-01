import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { generateRefreshToken, hashPassword, sha256Hex, verifyPassword } from "@hh/auth";
import { APP_CONFIG, type AppConfig } from "@hh/config";
import {
  ERROR_CODES,
  type AuthTokensView,
  type ForgotPasswordDto,
  type LoginDto,
  type RegisterDto,
  type ResetPasswordDto,
  type UserView,
  type VerifyEmailDto,
} from "@hh/contracts";
import { type User } from "@hh/database";
import { EMAIL_PORT, type EmailPort } from "@hh/notifications";
import type Redis from "ioredis";
import { REDIS } from "@hh/auth";
import { PrismaService } from "../infra/prisma.service";
import { AuditService } from "./audit.service";
import {
  LOCKOUT_COUNTER_TTL_SEC,
  lockoutSeconds,
  loginFailKey,
  loginLockKey,
} from "./lockout";
import { SessionService, type DeviceMeta } from "./session.service";
import { TokenService } from "./token.service";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 h

export const REGISTER_RESPONSE = {
  message: "If the email address is available, a verification email has been sent.",
} as const;

export const FORGOT_RESPONSE = {
  message: "If an account exists for that email, a password reset email has been sent.",
} as const;

export function toUserView(user: User, displayName: string | null): UserView {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    roles: user.roles as string[],
    status: user.status,
    displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  /** Lazily-computed argon2 hash used to equalize timing for unknown emails. */
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Registration & email verification
  // -------------------------------------------------------------------------

  /**
   * Always responds with the same generic body — an existing email is never
   * revealed. New accounts start as pending_verification with a profile row
   * and a 24h single-use email-verify token.
   */
  async register(dto: RegisterDto): Promise<typeof REGISTER_RESPONSE> {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      return REGISTER_RESPONSE;
    }

    const passwordHash = await hashPassword(dto.password);
    const rawToken = generateRefreshToken();
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: dto.email, passwordHash, status: "pending_verification" },
        });
        await tx.userProfile.create({ data: { userId: user.id } });
        await tx.authActionToken.create({
          data: {
            userId: user.id,
            kind: "email_verify",
            tokenHash: sha256Hex(rawToken),
            expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
          },
        });
      });
    } catch {
      // Unique-email race: behave exactly like the "already exists" path.
      return REGISTER_RESPONSE;
    }

    const verifyUrl = `${this.config.appBaseUrl}/verify-email?token=${rawToken}`;
    await this.email.sendMail({
      to: dto.email,
      subject: "Verify your Health House email",
      text: `Welcome to Health House!\n\nConfirm your email address by opening:\n${verifyUrl}\n\nThis link expires in 24 hours. If you did not sign up, ignore this email.`,
    });
    return REGISTER_RESPONSE;
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string }> {
    const tokenHash = sha256Hex(dto.token);
    const now = new Date();
    const consumed = await this.prisma.authActionToken.updateMany({
      where: { tokenHash, kind: "email_verify", usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count === 0) {
      throw new BadRequestException({ code: ERROR_CODES.AUTH_TOKEN_INVALID });
    }
    const token = await this.prisma.authActionToken.findUnique({ where: { tokenHash } });
    if (token) {
      await this.prisma.user.updateMany({
        where: { id: token.userId, deletedAt: null },
        data: { emailVerifiedAt: now },
      });
      await this.prisma.user.updateMany({
        where: { id: token.userId, status: "pending_verification" },
        data: { status: "active" },
      });
    }
    return { message: "Email verified. You can now log in." };
  }

  // -------------------------------------------------------------------------
  // Login with per-account exponential lockout
  // -------------------------------------------------------------------------

  async login(
    dto: LoginDto,
    meta: DeviceMeta,
  ): Promise<AuthTokensView & { user: UserView }> {
    if ((await this.redis.exists(loginLockKey(dto.email))) > 0) {
      throw new HttpException(
        { code: ERROR_CODES.AUTH_ACCOUNT_LOCKED },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      include: { profile: { select: { displayName: true } } },
    });

    // Verify against a dummy hash when there is no usable hash, so unknown
    // emails and OIDC-only accounts cost the same time as real ones.
    const passwordOk = user?.passwordHash
      ? await verifyPassword(user.passwordHash, dto.password)
      : await verifyPassword(await this.dummyHash(), dto.password);

    // Suspended/deleted/pending accounts fail with the same generic 401.
    if (!user || !passwordOk || user.status !== "active") {
      await this.recordLoginFailure(dto.email);
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_INVALID_CREDENTIALS });
    }

    await this.redis.del(loginFailKey(dto.email), loginLockKey(dto.email));

    const session = await this.sessions.createSession(user.id, meta);
    const tokens = await this.tokens.issueForNewSession(
      { id: user.id, roles: user.roles as string[] },
      session.id,
    );
    return { ...tokens, user: toUserView(user, user.profile?.displayName ?? null) };
  }

  private async recordLoginFailure(email: string): Promise<void> {
    const failKey = loginFailKey(email);
    const fails = await this.redis.incr(failKey);
    await this.redis.expire(failKey, LOCKOUT_COUNTER_TTL_SEC);
    const lockSec = lockoutSeconds(fails);
    if (lockSec > 0) {
      await this.redis.set(loginLockKey(email), "1", "EX", lockSec);
    }
  }

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= hashPassword(`dummy-${generateRefreshToken()}`);
    return this.dummyHashPromise;
  }

  // -------------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------------

  async forgotPassword(dto: ForgotPasswordDto): Promise<typeof FORGOT_RESPONSE> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null, status: { in: ["active", "pending_verification"] } },
      select: { id: true, email: true },
    });
    if (user) {
      const rawToken = generateRefreshToken();
      await this.prisma.authActionToken.create({
        data: {
          userId: user.id,
          kind: "password_reset",
          tokenHash: sha256Hex(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const resetUrl = `${this.config.appBaseUrl}/reset-password?token=${rawToken}`;
      await this.email.sendMail({
        to: user.email,
        subject: "Reset your Health House password",
        text: `A password reset was requested for your account.\n\nReset your password by opening:\n${resetUrl}\n\nThis link expires in 1 hour and can be used once. If you did not request this, ignore this email.`,
      });
    }
    return FORGOT_RESPONSE;
  }

  /** Single-use reset; on success every session of the user is revoked. */
  async resetPassword(dto: ResetPasswordDto, meta: DeviceMeta): Promise<{ message: string }> {
    const tokenHash = sha256Hex(dto.token);
    const now = new Date();
    const consumed = await this.prisma.authActionToken.updateMany({
      where: { tokenHash, kind: "password_reset", usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count === 0) {
      throw new BadRequestException({ code: ERROR_CODES.AUTH_TOKEN_INVALID });
    }
    const token = await this.prisma.authActionToken.findUnique({ where: { tokenHash } });
    if (!token) {
      throw new BadRequestException({ code: ERROR_CODES.AUTH_TOKEN_INVALID });
    }

    const passwordHash = await hashPassword(dto.password);
    await this.prisma.user.update({
      where: { id: token.userId },
      data: { passwordHash },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: token.userId },
      select: { roles: true },
    });
    await this.sessions.revokeAllForUser(token.userId, "password_reset", {
      actorId: token.userId,
      actorRoles: (user?.roles ?? []) as string[],
      ip: meta.ip,
    });
    await this.audit.append({
      actorId: token.userId,
      actorRoles: (user?.roles ?? []) as string[],
      action: "auth.password.reset",
      entityType: "user",
      entityId: token.userId,
      ip: meta.ip ?? null,
    });
    return { message: "Password updated. Please log in again." };
  }

  // -------------------------------------------------------------------------
  // Me
  // -------------------------------------------------------------------------

  async getMe(userId: string): Promise<UserView> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { profile: { select: { displayName: true } } },
    });
    if (!user) {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_UNAUTHORIZED });
    }
    return toUserView(user, user.profile?.displayName ?? null);
  }
}
