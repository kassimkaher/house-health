import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, clearAuthCookies, verifyPassword, type RequestUser } from "@hh/auth";
import {
  ERROR_CODES,
  ZodValidationPipe,
  selfDeleteAccountSchema,
  type SelfDeleteAccountDto,
} from "@hh/contracts";
import type { Response } from "express";
import { AuditService } from "../auth/audit.service";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/session.service";
import { PrismaService } from "../infra/prisma.service";

/**
 * Self-service account export & deletion — the PII inventory in
 * docs/security-privacy.md maps directly onto the tables read here. Export
 * covers everything the platform stores about the caller; deletion is a
 * password-confirmed soft delete that revokes every active session
 * immediately, mirroring the admin-initiated flow but scoped to "myself".
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async export(userId: string): Promise<Record<string, unknown>> {
    const [
      user,
      profile,
      weightEntries,
      calcSnapshots,
      recipes,
      mealGroups,
      diaryEntries,
      reminders,
      shortcuts,
      sessions,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, roles: true, status: true, createdAt: true, emailVerifiedAt: true },
      }),
      this.prisma.userProfile.findUnique({ where: { userId } }),
      this.prisma.weightEntry.findMany({ where: { userId }, orderBy: { measuredOn: "asc" } }),
      this.prisma.calculationSnapshot.findMany({ where: { userId }, orderBy: { effectiveFrom: "asc" } }),
      this.prisma.recipe.findMany({ where: { ownerUserId: userId }, include: { ingredients: true } }),
      this.prisma.mealGroup.findMany({ where: { userId }, include: { items: true } }),
      this.prisma.diaryEntry.findMany({ where: { userId }, orderBy: { entryDate: "asc" } }),
      this.prisma.reminder.findMany({ where: { userId } }),
      this.prisma.userShortcut.findMany({ where: { userId } }),
      this.prisma.session.findMany({
        where: { userId },
        select: { id: true, deviceName: true, userAgent: true, ipCreated: true, createdAt: true, revokedAt: true },
      }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      user,
      profile,
      weightEntries,
      calculationSnapshots: calcSnapshots,
      recipes,
      mealGroups,
      diaryEntries,
      reminders,
      shortcuts,
      sessions,
    };
  }

  async selfDelete(userId: string, dto: SelfDeleteAccountDto, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, dto.password))) {
      throw new UnauthorizedException({ code: ERROR_CODES.AUTH_INVALID_CREDENTIALS });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: "deleted", deletedAt: new Date() },
    });
    await this.sessions.revokeAllForUser(userId, "self_delete", {
      actorId: userId,
      actorRoles: user.roles,
      ...(ip ? { ip } : {}),
    });
    await this.audit.append({ actorId: userId, actorRoles: user.roles, action: "user.self_delete", entityType: "user", entityId: userId });
  }
}

@ApiTags("account")
@ApiBearerAuth()
@Controller("me")
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Get("export")
  @ApiOperation({ summary: "Export everything the platform stores about the caller (PII + activity)" })
  export(@CurrentUser() user: RequestUser): Promise<Record<string, unknown>> {
    return this.account.export(user.userId);
  }

  @Post("delete")
  @HttpCode(204)
  @ApiOperation({ summary: "Password-confirmed self-service account deletion (soft delete, revokes all sessions)" })
  async selfDelete(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(selfDeleteAccountSchema)) dto: SelfDeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!dto.confirm) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_FAILED });
    }
    await this.account.selfDelete(user.userId, dto, res.req.ip);
    clearAuthCookies(res);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
