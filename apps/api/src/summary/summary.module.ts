import { Controller, Get, Inject, Injectable, Module, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type RequestUser } from "@hh/auth";
import { ZodValidationPipe } from "@hh/contracts";
import {
  evaluateDailyGuidance,
  evaluateWeightGuidance,
  sumSnapshotNutrients,
  type GuidanceMessage,
  type NutritionSnapshot,
} from "@hh/domain";
import { z } from "zod";
import { ConsumptionModule } from "../consumption/consumption.module";
import { RecentsService } from "../consumption/recents.service";
import { PrismaService } from "../infra/prisma.service";
import { ProfileModule } from "../profile/profile.module";
import { ProfileService } from "../profile/profile.service";

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface CalcTarget {
  targetKcal: number;
  macros: { proteinG?: number; carbsG?: number; fatG?: number };
}

@Injectable()
export class SummaryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async target(userId: string): Promise<CalcTarget | null> {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!profile?.activeCalcSnapshotId) return null;
    const snap = await this.prisma.calculationSnapshot.findUnique({
      where: { id: profile.activeCalcSnapshotId },
    });
    const outputs = snap?.outputs as { targetKcal?: number; macros?: CalcTarget["macros"] } | undefined;
    return outputs?.targetKcal ? { targetKcal: outputs.targetKcal, macros: outputs.macros ?? {} } : null;
  }

  private async dayTotals(userId: string, date: Date): Promise<Record<string, number>> {
    const entries = await this.prisma.diaryEntry.findMany({
      where: { userId, entryDate: date, status: "consumed", deletedAt: null },
      select: { nutritionSnapshot: true },
    });
    return sumSnapshotNutrients(entries.map((e) => e.nutritionSnapshot as unknown as NutritionSnapshot));
  }

  async daily(userId: string, dateStr: string) {
    const totals = await this.dayTotals(userId, new Date(`${dateStr}T00:00:00Z`));
    const target = await this.target(userId);
    const consumedKcal = totals.energy_kcal ?? 0;
    const guidance = evaluateDailyGuidance({
      consumedKcal,
      targetKcal: target?.targetKcal ?? null,
      proteinG: totals.protein_g ?? 0,
      proteinTargetG: target?.macros.proteinG ?? null,
      fiberG: totals.fiber_g ?? 0,
      sodiumMg: totals.sodium_mg ?? 0,
    });
    return {
      date: dateStr,
      consumed: totals,
      target,
      remainingKcal: target ? Math.round(target.targetKcal - consumedKcal) : null,
      overUnderKcal: target ? Math.round(consumedKcal - target.targetKcal) : null,
      macroProgress: target
        ? {
            proteinPct: target.macros.proteinG ? Math.round(((totals.protein_g ?? 0) / target.macros.proteinG) * 100) : null,
            carbsPct: target.macros.carbsG ? Math.round(((totals.carbs_g ?? 0) / target.macros.carbsG) * 100) : null,
            fatPct: target.macros.fatG ? Math.round(((totals.fat_g ?? 0) / target.macros.fatG) * 100) : null,
          }
        : null,
      guidance,
    };
  }

  async week(userId: string, endDateStr: string) {
    const end = new Date(`${endDateStr}T00:00:00Z`);
    const days: Array<{ date: string; totals: Record<string, number> }> = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(end.getTime() - i * 86_400_000);
      days.push({ date: date.toISOString().slice(0, 10), totals: await this.dayTotals(userId, date) });
    }
    const daysWithData = days.filter((d) => (d.totals.energy_kcal ?? 0) > 0);
    const divisor = Math.max(daysWithData.length, 1);
    const averages: Record<string, number> = {};
    for (const day of daysWithData) {
      for (const [key, value] of Object.entries(day.totals)) {
        averages[key] = (averages[key] ?? 0) + value;
      }
    }
    for (const key of Object.keys(averages)) {
      averages[key] = Math.round(((averages[key] ?? 0) / divisor) * 10) / 10;
    }
    const target = await this.target(userId);
    return { endDate: endDateStr, days, daysLogged: daysWithData.length, averages, target };
  }
}

@ApiTags("summary")
@ApiBearerAuth()
@Controller()
export class SummaryController {
  constructor(
    @Inject(SummaryService) private readonly summaries: SummaryService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(RecentsService) private readonly recents: RecentsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get("summary/daily/:date")
  @ApiOperation({ summary: "Daily summary: totals vs target + versioned guidance rules" })
  daily(@CurrentUser() user: RequestUser, @Param("date", new ZodValidationPipe(dateParam)) date: string) {
    return this.summaries.daily(user.userId, date);
  }

  @Get("summary/week/:endDate")
  @ApiOperation({ summary: "Seven-day averages ending at a date" })
  week(@CurrentUser() user: RequestUser, @Param("endDate", new ZodValidationPipe(dateParam)) endDate: string) {
    return this.summaries.week(user.userId, endDate);
  }

  @Get("summary/weight-trend")
  @ApiOperation({ summary: "Weight trend vs goal with guidance" })
  async weightTrend(@CurrentUser() user: RequestUser): Promise<{
    trend: Awaited<ReturnType<ProfileService["weightTrend"]>>;
    guidance: GuidanceMessage[];
  }> {
    const trend = await this.profiles.weightTrend(user.userId);
    const profile = await this.prisma.userProfile.findUnique({ where: { userId: user.userId } });
    const guidance = evaluateWeightGuidance({
      changeKg30d: trend.changeKg30d,
      goalType: profile?.goalType ?? "maintain",
      goalRateKgPerWeek: profile?.goalRateKgPerWeek ? Number(profile.goalRateKgPerWeek) : null,
    });
    return { trend, guidance };
  }

  @Get("home")
  @ApiOperation({ summary: "Aggregated mobile home-screen payload" })
  async home(@CurrentUser() user: RequestUser) {
    const today = new Date().toISOString().slice(0, 10);
    const [profile, daily, recentFoods, favorites, nextReminder] = await Promise.all([
      this.profiles.getProfile(user.userId),
      this.summaries.daily(user.userId, today),
      this.recents.list(user.userId, 10),
      this.prisma.userShortcut.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      this.prisma.reminder.findFirst({
        where: { userId: user.userId, isEnabled: true, deletedAt: null, nextFireAt: { not: null } },
        orderBy: { nextFireAt: "asc" },
        select: { id: true, type: true, timeLocal: true, nextFireAt: true },
      }),
    ]);
    return {
      profile: { displayName: profile.displayName, preferredLanguage: profile.preferredLanguage },
      today: daily,
      recents: recentFoods,
      favorites,
      nextReminder,
    };
  }
}

@Module({
  imports: [ConsumptionModule, ProfileModule],
  controllers: [SummaryController],
  providers: [SummaryService],
})
export class SummaryModule {}
