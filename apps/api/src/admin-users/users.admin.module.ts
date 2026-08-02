import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermission, type RequestUser } from "@hh/auth";
import {
  ERROR_CODES,
  ZodValidationPipe,
  listUsersQuerySchema,
  setUserRolesSchema,
  suspendUserSchema,
  type ListUsersQuery,
  type SetUserRolesDto,
  type SuspendUserDto,
} from "@hh/contracts";
import type { Prisma, User } from "@hh/database";
import type { Request } from "express";
import { AuditService } from "../auth/audit.service";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/session.service";
import { PrismaService } from "../infra/prisma.service";

const USER_LIST_SELECT = {
  id: true,
  email: true,
  roles: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery) {
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { roles: { has: query.role } } : {}),
      ...(query.q ? { email: { contains: query.q, mode: "insensitive" } } : {}),
    };
    const items = await this.prisma.user.findMany({
      where,
      select: USER_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const nextCursor = items.length > query.limit ? (items.pop()?.id ?? null) : null;
    return { items, nextCursor };
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...USER_LIST_SELECT, profile: { select: { displayName: true, locale: true, timezone: true } } },
    });
    if (!user) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    const sessionCount = await this.prisma.session.count({ where: { userId: id, revokedAt: null } });
    return { ...user, activeSessionCount: sessionCount };
  }

  async setRoles(actorId: string, actorRoles: readonly string[], id: string, dto: SetUserRolesDto): Promise<User> {
    if (id === actorId && !dto.roles.includes("super_admin")) {
      // A super_admin can't strip their own super_admin role — avoids
      // an admin accidentally locking themselves out of user management.
      const target = await this.prisma.user.findUnique({ where: { id } });
      if (target?.roles.includes("super_admin")) {
        throw new BadRequestException({ code: ERROR_CODES.ADMIN_SELF_ACTION_BLOCKED });
      }
    }
    const before = await this.prisma.user.findUnique({ where: { id }, select: { roles: true } });
    if (!before) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    const user = await this.prisma.user.update({ where: { id }, data: { roles: dto.roles } });
    await this.audit.append({
      actorId,
      actorRoles,
      action: "user.roles.set",
      entityType: "user",
      entityId: id,
      before: { roles: before.roles },
      after: { roles: dto.roles },
    });
    return user;
  }

  async suspend(
    actorId: string,
    actorRoles: readonly string[],
    id: string,
    dto: SuspendUserDto,
    ip?: string,
  ): Promise<User> {
    if (id === actorId) {
      throw new BadRequestException({ code: ERROR_CODES.ADMIN_SELF_ACTION_BLOCKED });
    }
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    const user = await this.prisma.user.update({ where: { id }, data: { status: "suspended" } });
    // Suspension must be immediate: denylist every active session's sid.
    await this.sessions.revokeAllForUser(id, "suspended", { actorId, actorRoles, ...(ip ? { ip } : {}) });
    await this.audit.append({
      actorId,
      actorRoles,
      action: "user.suspend",
      entityType: "user",
      entityId: id,
      after: { reason: dto.reason },
    });
    return user;
  }

  async reactivate(actorId: string, actorRoles: readonly string[], id: string): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    const user = await this.prisma.user.update({ where: { id }, data: { status: "active" } });
    await this.audit.append({ actorId, actorRoles, action: "user.reactivate", entityType: "user", entityId: id });
    return user;
  }

  /** Soft delete with an auditable retention path — never a hard DELETE. */
  async softDelete(actorId: string, actorRoles: readonly string[], id: string, ip?: string): Promise<void> {
    if (id === actorId) {
      throw new BadRequestException({ code: ERROR_CODES.ADMIN_SELF_ACTION_BLOCKED });
    }
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    await this.prisma.user.update({
      where: { id },
      data: { status: "deleted", deletedAt: new Date() },
    });
    await this.sessions.revokeAllForUser(id, "account_deleted", { actorId, actorRoles, ...(ip ? { ip } : {}) });
    await this.audit.append({ actorId, actorRoles, action: "user.soft_delete", entityType: "user", entityId: id });
  }
}

@ApiTags("admin/users")
@ApiBearerAuth()
@Controller("admin/users")
export class UsersAdminController {
  constructor(@Inject(UsersAdminService) private readonly users: UsersAdminService) {}

  @Get()
  @RequirePermission("users.support")
  @ApiOperation({ summary: "List/search users (cursor-paginated)" })
  list(@Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Get(":id")
  @RequirePermission("users.support")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post(":id/roles")
  @HttpCode(200)
  @RequirePermission("users.manage")
  @ApiOperation({ summary: "Replace a user's role set (super_admin only)" })
  setRoles(
    @CurrentUser() actor: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setUserRolesSchema)) dto: SetUserRolesDto,
  ) {
    return this.users.setRoles(actor.userId, actor.roles, id, dto);
  }

  @Post(":id/suspend")
  @HttpCode(200)
  @RequirePermission("users.support")
  @ApiOperation({ summary: "Suspend an account; revokes every active session immediately" })
  suspend(
    @CurrentUser() actor: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(suspendUserSchema)) dto: SuspendUserDto,
    @Req() req: Request,
  ) {
    return this.users.suspend(actor.userId, actor.roles, id, dto, typeof req.ip === "string" ? req.ip : undefined);
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @RequirePermission("users.support")
  reactivate(@CurrentUser() actor: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.users.reactivate(actor.userId, actor.roles, id);
  }

  @Post(":id/delete")
  @HttpCode(204)
  @RequirePermission("users.manage")
  @ApiOperation({ summary: "Soft-delete an account (auditable retention, not a hard delete)" })
  async softDelete(@CurrentUser() actor: RequestUser, @Param("id", ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.users.softDelete(actor.userId, actor.roles, id, typeof req.ip === "string" ? req.ip : undefined);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [UsersAdminController],
  providers: [UsersAdminService],
})
export class UsersAdminModule {}
