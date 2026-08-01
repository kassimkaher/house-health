import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, UserProfile, WeightEntry } from "@hh/database";
import {
  ERROR_CODES,
  type ListWeightQuery,
  type ProfileView,
  type UpdateProfileDto,
  type UpsertWeightDto,
  type UpdateWeightDto,
  type WeightEntryView,
  type WeightTrendView,
} from "@hh/contracts";
import { PrismaService } from "../infra/prisma.service";

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toProfileView(p: UserProfile): ProfileView {
  return {
    displayName: p.displayName,
    locale: p.locale,
    preferredLanguage: p.preferredLanguage,
    timezone: p.timezone,
    sex: p.sex,
    birthDate: p.birthDate ? isoDate(p.birthDate) : null,
    heightCm: p.heightCm ? Number(p.heightCm) : null,
    currentWeightKg: p.currentWeightKg ? Number(p.currentWeightKg) : null,
    targetWeightKg: p.targetWeightKg ? Number(p.targetWeightKg) : null,
    activityLevel: p.activityLevel,
    goalType: p.goalType,
    goalRateKgPerWeek: p.goalRateKgPerWeek ? Number(p.goalRateKgPerWeek) : null,
    dietaryPrefs: p.dietaryPrefs,
    allergies: p.allergies,
    excludedFoods: p.excludedFoods,
    unitPreference: p.unitPreference,
    medicalAckAt: p.medicalAckAt ? p.medicalAckAt.toISOString() : null,
    activeCalcSnapshotId: p.activeCalcSnapshotId,
  };
}

function toWeightView(w: WeightEntry): WeightEntryView {
  return {
    id: w.id,
    measuredOn: isoDate(w.measuredOn),
    weightKg: Number(w.weightKg),
    source: w.source,
    note: w.note,
    createdAt: w.createdAt.toISOString(),
  };
}

@Injectable()
export class ProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<ProfileView> {
    const profile = await this.ensureProfile(userId);
    return toProfileView(profile);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileView> {
    await this.ensureProfile(userId);
    const { medicalAck, birthDate, ...rest } = dto;
    // exactOptionalPropertyTypes: drop undefined keys before handing to Prisma.
    const data = Object.fromEntries(
      Object.entries({
        ...rest,
        ...(birthDate !== undefined
          ? { birthDate: birthDate === null ? null : new Date(`${birthDate}T00:00:00Z`) }
          : {}),
        ...(medicalAck !== undefined ? { medicalAckAt: medicalAck ? new Date() : null } : {}),
      }).filter(([, value]) => value !== undefined),
    ) as Prisma.UserProfileUpdateInput;
    const updated = await this.prisma.userProfile.update({ where: { userId }, data });
    return toProfileView(updated);
  }

  /** Upsert by (user, date): logging twice on one day replaces the value. */
  async upsertWeight(userId: string, dto: UpsertWeightDto): Promise<WeightEntryView> {
    const measuredOn = new Date(`${dto.measuredOn}T00:00:00Z`);
    const entry = await this.prisma.weightEntry.upsert({
      where: { userId_measuredOn: { userId, measuredOn } },
      update: { weightKg: dto.weightKg, note: dto.note ?? null },
      create: { userId, measuredOn, weightKg: dto.weightKg, note: dto.note ?? null, source: "manual" },
    });
    await this.syncCurrentWeight(userId);
    return toWeightView(entry);
  }

  async updateWeight(userId: string, id: string, dto: UpdateWeightDto): Promise<WeightEntryView> {
    const existing = await this.prisma.weightEntry.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    }
    const entry = await this.prisma.weightEntry.update({
      where: { id },
      data: {
        ...(dto.weightKg !== undefined ? { weightKg: dto.weightKg } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });
    await this.syncCurrentWeight(userId);
    return toWeightView(entry);
  }

  async deleteWeight(userId: string, id: string): Promise<void> {
    const deleted = await this.prisma.weightEntry.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    }
    await this.syncCurrentWeight(userId);
  }

  async listWeight(userId: string, query: ListWeightQuery): Promise<WeightEntryView[]> {
    const entries = await this.prisma.weightEntry.findMany({
      where: {
        userId,
        ...(query.from ? { measuredOn: { gte: new Date(`${query.from}T00:00:00Z`) } } : {}),
        ...(query.to
          ? { measuredOn: { ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}), lte: new Date(`${query.to}T00:00:00Z`) } }
          : {}),
      },
      orderBy: { measuredOn: "desc" },
      take: query.limit,
    });
    return entries.map(toWeightView);
  }

  async weightTrend(userId: string): Promise<WeightTrendView> {
    const [entries, profile] = await Promise.all([
      this.prisma.weightEntry.findMany({
        where: { userId },
        orderBy: { measuredOn: "desc" },
        take: 60,
      }),
      this.prisma.userProfile.findUnique({ where: { userId } }),
    ]);
    const latest = entries[0] ?? null;
    const changeOver = (days: number): number | null => {
      if (!latest) return null;
      const cutoff = new Date(latest.measuredOn.getTime() - days * 86_400_000);
      const past = entries.find((e) => e.measuredOn <= cutoff);
      if (!past) return null;
      return Number((Number(latest.weightKg) - Number(past.weightKg)).toFixed(2));
    };
    const targetWeightKg = profile?.targetWeightKg ? Number(profile.targetWeightKg) : null;
    return {
      latest: latest ? toWeightView(latest) : null,
      changeKg7d: changeOver(7),
      changeKg30d: changeOver(30),
      targetWeightKg,
      remainingToTargetKg:
        latest && targetWeightKg !== null
          ? Number((Number(latest.weightKg) - targetWeightKg).toFixed(2))
          : null,
      entryCount: entries.length,
    };
  }

  private async ensureProfile(userId: string): Promise<UserProfile> {
    const existing = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    // Profiles are created at registration; this covers OIDC-created users.
    return this.prisma.userProfile.create({ data: { userId } });
  }

  /** Keep profile.currentWeightKg in sync with the newest weight entry. */
  private async syncCurrentWeight(userId: string): Promise<void> {
    const latest = await this.prisma.weightEntry.findFirst({
      where: { userId },
      orderBy: { measuredOn: "desc" },
    });
    await this.prisma.userProfile.updateMany({
      where: { userId },
      data: { currentWeightKg: latest ? latest.weightKg : null },
    });
  }
}
