import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type UserRole } from "@hh/database";
import { PrismaService } from "../infra/prisma.service";

export interface AuditEntry {
  actorId?: string | null;
  actorRoles?: readonly string[];
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
}

/**
 * Appends to the append-only audit_log. Audited in this phase: session
 * revocations (logout / remote revoke / refresh-reuse / password reset) and
 * password resets. Role changes are audited by the admin phase.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorRoles: (entry.actorRoles ?? []) as UserRole[],
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before:
          entry.before === undefined ? Prisma.DbNull : (entry.before as Prisma.InputJsonValue),
        after:
          entry.after === undefined ? Prisma.DbNull : (entry.after as Prisma.InputJsonValue),
        ip: entry.ip ?? null,
        requestId: entry.requestId ?? null,
      },
    });
  }
}
