import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, Public, type RequestUser } from "@hh/auth";
import {
  ZodValidationPipe,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type AuthTokensView,
  type ForgotPasswordDto,
  type LoginDto,
  type RefreshDto,
  type RegisterDto,
  type ResetPasswordDto,
  type SessionView,
  type UserView,
  type VerifyEmailDto,
} from "@hh/contracts";
import type { Request } from "express";
import { AuthService, type FORGOT_RESPONSE, type REGISTER_RESPONSE } from "./auth.service";
import { OidcService } from "./oidc.service";
import { SessionService, type DeviceMeta } from "./session.service";
import { TokenService } from "./token.service";

/** Stricter per-IP budget for auth endpoints (relaxed under test). */
const AUTH_RATE_LIMIT = process.env.NODE_ENV === "test" ? 10_000 : 10;

function requestMeta(req: Request, extra?: { deviceName?: string; deviceId?: string }): DeviceMeta {
  const userAgent = req.headers["user-agent"];
  const meta: DeviceMeta = {};
  if (extra?.deviceName !== undefined) meta.deviceName = extra.deviceName;
  if (extra?.deviceId !== undefined) meta.deviceId = extra.deviceId;
  if (typeof userAgent === "string") meta.userAgent = userAgent;
  if (typeof req.ip === "string") meta.ip = req.ip;
  return meta;
}

@ApiTags("auth")
@Throttle({ general: { limit: AUTH_RATE_LIMIT, ttl: 60_000 } })
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post("register")
  @ApiOperation({ summary: "Register with email + password (always generic 201)" })
  register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
  ): Promise<typeof REGISTER_RESPONSE> {
    return this.auth.register(dto);
  }

  @Public()
  @Post("verify-email")
  @HttpCode(200)
  @ApiOperation({ summary: "Consume an email-verification token" })
  verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) dto: VerifyEmailDto,
  ): Promise<{ message: string }> {
    return this.auth.verifyEmail(dto);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Email + password login; creates a device session" })
  login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: Request,
  ): Promise<AuthTokensView & { user: UserView }> {
    const extra: { deviceName?: string; deviceId?: string } = {};
    if (dto.deviceName !== undefined) extra.deviceName = dto.deviceName;
    if (dto.deviceId !== undefined) extra.deviceId = dto.deviceId;
    return this.auth.login(dto, requestMeta(req, extra));
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Rotate a refresh token (reuse revokes the family)" })
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto,
  ): Promise<AuthTokensView> {
    const result = await this.tokens.rotate(dto.refreshToken);
    return result.tokens;
  }

  @Post("logout")
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke the current session" })
  async logout(@CurrentUser() user: RequestUser, @Req() req: Request): Promise<void> {
    await this.sessions.revokeSession(user.sessionId, "logout", {
      actorId: user.userId,
      actorRoles: user.roles,
      ip: typeof req.ip === "string" ? req.ip : undefined,
    });
  }

  @Public()
  @Post("password/forgot")
  @HttpCode(202)
  @ApiOperation({ summary: "Request a password-reset email (always 202)" })
  forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto,
  ): Promise<typeof FORGOT_RESPONSE> {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Post("password/reset")
  @HttpCode(200)
  @ApiOperation({ summary: "Reset password with a single-use token; revokes all sessions" })
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    return this.auth.resetPassword(dto, requestMeta(req));
  }

  @Get("sessions")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the caller's active device sessions" })
  listSessions(@CurrentUser() user: RequestUser): Promise<SessionView[]> {
    return this.sessions.listSessions(user.userId, user.sessionId);
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke one of the caller's sessions (404 if not owned)" })
  async revokeSession(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.sessions.revokeOwnedSession(
      user.userId,
      id,
      {
        actorId: user.userId,
        actorRoles: user.roles,
        ip: typeof req.ip === "string" ? req.ip : undefined,
      },
      "revoked_by_owner",
    );
  }

  @Public()
  @Get("google/start")
  @ApiOperation({ summary: "Begin Google OIDC (503 when unconfigured)" })
  googleStart(): Promise<{ url: string }> {
    return this.oidc.start();
  }

  @Public()
  @Get("google/callback")
  @ApiOperation({ summary: "Google OIDC redirect target; issues tokens" })
  googleCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Req() req: Request,
  ): Promise<AuthTokensView & { user: UserView }> {
    return this.oidc.callback(code ?? "", state ?? "", requestMeta(req));
  }
}
