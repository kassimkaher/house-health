import { BadRequestException, Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { CalculationSnapshot } from "@hh/database";
import { ERROR_CODES, type CalcSnapshotView } from "@hh/contracts";
import {
  CalcValidationError,
  calculateEnergyTargets,
  type CalcInputs,
  type CalcPolicyConfig,
  type CalcResult,
} from "@hh/domain";
import { PrismaService } from "../infra/prisma.service";

function toView(snapshot: CalculationSnapshot, policyKey: string, policyVersion: number): CalcSnapshotView {
  const outputs = snapshot.outputs as unknown as CalcResult;
  return {
    id: snapshot.id,
    policyKey,
    policyVersion,
    bmr: outputs.bmr,
    maintenanceKcal: outputs.maintenanceKcal,
    targetKcal: outputs.targetKcal,
    appliedDeltaKcal: outputs.appliedDeltaKcal,
    macros: outputs.macros,
    warnings: outputs.warnings,
    explanation: outputs.explanation,
    effectiveFrom: snapshot.effectiveFrom.toISOString(),
  };
}

@Injectable()
export class CalcService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Run the versioned engine against the caller's profile, persist an
   * immutable snapshot, and mark it active on the profile.
   */
  async estimate(userId: string): Promise<CalcSnapshotView> {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    const sex = profile?.sex ?? null;
    const birthDate = profile?.birthDate ?? null;
    const heightCm = profile?.heightCm ?? null;
    const currentWeightKg = profile?.currentWeightKg ?? null;
    const missing: string[] = [];
    if (!sex) missing.push("sex");
    if (!birthDate) missing.push("birthDate");
    if (!heightCm) missing.push("heightCm");
    if (!currentWeightKg) missing.push("currentWeightKg");
    if (!profile || !sex || !birthDate || !heightCm || !currentWeightKg) {
      throw new UnprocessableEntityException({
        code: ERROR_CODES.CALC_PROFILE_INCOMPLETE,
        fields: missing.map((path) => ({ path, message: "required for calorie estimation" })),
      });
    }

    const policy = await this.prisma.calculationPolicy.findFirst({
      where: { key: "mifflin_st_jeor", isActive: true },
    });
    if (!policy) {
      throw new UnprocessableEntityException({ code: ERROR_CODES.CALC_NO_ACTIVE_POLICY });
    }

    const inputs: CalcInputs = {
      sex,
      birthDate: birthDate.toISOString().slice(0, 10),
      heightCm: Number(heightCm),
      weightKg: Number(currentWeightKg),
      activityLevel: profile.activityLevel,
      goalType: profile.goalType,
      goalRateKgPerWeek: profile.goalRateKgPerWeek ? Number(profile.goalRateKgPerWeek) : undefined,
    };

    let result: CalcResult;
    try {
      result = calculateEnergyTargets(inputs, policy.config as unknown as CalcPolicyConfig, policy.version, new Date());
    } catch (err) {
      if (err instanceof CalcValidationError) {
        throw new BadRequestException({
          code: ERROR_CODES.CALC_INVALID_INPUTS,
          fields: err.errors.map((e) => ({ path: e.field, message: e.message })),
        });
      }
      throw err;
    }

    const snapshot = await this.prisma.$transaction(async (tx) => {
      const created = await tx.calculationSnapshot.create({
        data: {
          userId,
          policyId: policy.id,
          inputs: inputs as object,
          outputs: result as unknown as object,
        },
      });
      await tx.userProfile.update({
        where: { userId },
        data: { activeCalcSnapshotId: created.id },
      });
      return created;
    });

    return toView(snapshot, policy.key, policy.version);
  }

  async current(userId: string): Promise<CalcSnapshotView | null> {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!profile?.activeCalcSnapshotId) return null;
    const snapshot = await this.prisma.calculationSnapshot.findFirst({
      where: { id: profile.activeCalcSnapshotId, userId },
      include: { policy: true },
    });
    if (!snapshot) return null;
    return toView(snapshot, snapshot.policy.key, snapshot.policy.version);
  }

  async history(userId: string, limit = 20): Promise<CalcSnapshotView[]> {
    const snapshots = await this.prisma.calculationSnapshot.findMany({
      where: { userId },
      orderBy: { effectiveFrom: "desc" },
      take: limit,
      include: { policy: true },
    });
    return snapshots.map((s) => toView(s, s.policy.key, s.policy.version));
  }
}
