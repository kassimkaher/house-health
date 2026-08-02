import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "@hh/auth";
import { ZodValidationPipe, listAuditLogQuerySchema, type ListAuditLogQuery } from "@hh/contracts";
import type { AuditLog, Prisma } from "@hh/database";
import { PrismaService } from "../infra/prisma.service";

function serializeAudit(row: AuditLog): Omit<AuditLog, "id"> & { id: string } {
  return { ...row, id: row.id.toString() };
}

@ApiTags("admin/audit")
@ApiBearerAuth()
@Controller("admin/audit")
export class AuditAdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission("audit.read")
  @ApiOperation({ summary: "Query the append-only audit log (cursor-paginated, newest first)" })
  async list(@Query(new ZodValidationPipe(listAuditLogQuerySchema)) query: ListAuditLogQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.cursor ? { id: { lt: BigInt(query.cursor) } } : {}),
    };
    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: "desc" },
      take: query.limit,
    });
    const serialized = items.map(serializeAudit);
    const nextCursor = items.length === query.limit ? serialized[serialized.length - 1]!.id : null;
    return { items: serialized, nextCursor };
  }
}
