import { Body, Controller, Get, HttpCode, Inject, Injectable, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermission, type RequestUser } from "@hh/auth";
import { ZodValidationPipe, createCalcPolicySchema, type CreateCalcPolicyDto } from "@hh/contracts";
import type { CalculationPolicy, Prisma } from "@hh/database";
import { AuditService } from "../auth/audit.service";
import { PrismaService } from "../infra/prisma.service";

@Injectable()
export class CalcPoliciesAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(): Promise<CalculationPolicy[]> {
    return this.prisma.calculationPolicy.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
  }

  /** Creates a new version; activating it deactivates the prior active row
   *  for the same key in the same transaction (partial-unique backstop). */
  async create(actorId: string, actorRoles: readonly string[], dto: CreateCalcPolicyDto): Promise<CalculationPolicy> {
    const latest = await this.prisma.calculationPolicy.findFirst({
      where: { key: dto.key },
      orderBy: { version: "desc" },
    });
    const version = (latest?.version ?? 0) + 1;
    const policy = await this.prisma.$transaction(async (tx) => {
      if (dto.activate) {
        await tx.calculationPolicy.updateMany({ where: { key: dto.key, isActive: true }, data: { isActive: false } });
      }
      return tx.calculationPolicy.create({
        data: {
          key: dto.key,
          version,
          isActive: dto.activate,
          config: dto.config as Prisma.InputJsonValue,
          notes: dto.notes ?? null,
        },
      });
    });
    await this.audit.append({
      actorId,
      actorRoles,
      action: "calc_policy.create",
      entityType: "calculation_policy",
      entityId: policy.id,
      after: { key: dto.key, version, activated: dto.activate },
    });
    return policy;
  }
}

@ApiTags("admin/calc-policies")
@ApiBearerAuth()
@Controller("admin/calc-policies")
export class CalcPoliciesAdminController {
  constructor(@Inject(CalcPoliciesAdminService) private readonly policies: CalcPoliciesAdminService) {}

  @Get()
  @RequirePermission("policies.manage")
  @ApiOperation({ summary: "All calculation policy versions" })
  list(): Promise<CalculationPolicy[]> {
    return this.policies.list();
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("policies.manage")
  @ApiOperation({ summary: "Create a new policy version; optionally activate it immediately" })
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createCalcPolicySchema)) dto: CreateCalcPolicyDto,
  ): Promise<CalculationPolicy> {
    return this.policies.create(user.userId, user.roles, dto);
  }
}
