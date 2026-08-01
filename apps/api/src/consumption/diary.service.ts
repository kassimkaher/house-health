import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { DiaryEntry, Prisma } from "@hh/database";
import {
  ERROR_CODES,
  type CopyDiaryDto,
  type CreateDiaryEntryDto,
  type UpdateDiaryEntryDto,
} from "@hh/contracts";
import { scaleNutrients, sumSnapshotNutrients, type NutritionSnapshot } from "@hh/domain";
import { PrismaService } from "../infra/prisma.service";
import { RecentsService } from "./recents.service";
import { SnapshotResolverService } from "./snapshot-resolver.service";

interface RecipeTotalsShape {
  perServing: Record<string, number>;
}

@Injectable()
export class DiaryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SnapshotResolverService) private readonly snapshots: SnapshotResolverService,
    @Inject(RecentsService) private readonly recents: RecentsService,
  ) {}

  private date(value: string): Date {
    return new Date(`${value}T00:00:00Z`);
  }

  /** Meal-group entries expand into one row per group item. */
  async create(userId: string, dto: CreateDiaryEntryDto): Promise<DiaryEntry[]> {
    if (dto.itemType === "meal_group") {
      return this.createFromMealGroup(userId, dto);
    }
    const entry =
      dto.itemType === "food"
        ? await this.createFoodEntry(userId, dto)
        : await this.createRecipeEntry(userId, dto);
    return [entry];
  }

  private async createFoodEntry(userId: string, dto: CreateDiaryEntryDto): Promise<DiaryEntry> {
    const { snapshot, grams } = await this.snapshots.forFood({
      foodId: dto.foodId!,
      quantity: dto.quantity,
      unit: dto.unit,
      portionLabelEn: dto.portionLabelEn,
    });
    const entry = await this.prisma.diaryEntry.create({
      data: {
        userId,
        entryDate: this.date(dto.entryDate),
        mealSlot: dto.mealSlot,
        customSlotName: dto.mealSlot === "custom" ? (dto.customSlotName ?? null) : null,
        status: dto.status,
        itemType: "food",
        foodId: dto.foodId!,
        quantity: dto.quantity,
        unit: dto.unit,
        grams,
        nutritionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        note: dto.note ?? null,
      },
    });
    await this.recents.touch(userId, dto.foodId!);
    return entry;
  }

  private async createRecipeEntry(userId: string, dto: CreateDiaryEntryDto): Promise<DiaryEntry> {
    const recipe = await this.prisma.recipe.findFirst({
      where: { id: dto.recipeId!, ownerUserId: userId, deletedAt: null },
    });
    if (!recipe) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    const totals = recipe.nutritionTotals as unknown as RecipeTotalsShape | null;
    if (!totals?.perServing) {
      throw new UnprocessableEntityException({ code: ERROR_CODES.FOOD_NOT_AVAILABLE, reason: "recipe_has_no_totals" });
    }
    const nutrients = scaleNutrients(totals.perServing, dto.quantity);
    const snapshot: NutritionSnapshot = {
      v: 1,
      basis: {
        quantity: dto.quantity,
        unit: "serving",
        grams: recipe.cookedWeightGrams
          ? (Number(recipe.cookedWeightGrams) / Number(recipe.servings)) * dto.quantity
          : 0,
        portionLabelAr: "حصة",
        portionLabelEn: "serving",
      },
      source: {
        foodId: recipe.id,
        foodVersionId: null,
        releaseId: null,
        nameAr: recipe.titleAr,
        nameEn: recipe.titleEn ?? recipe.titleAr,
        brandName: null,
        computedAt: new Date().toISOString(),
        calcVersion: "nutrition-calc@1",
      },
      nutrients,
    };
    return this.prisma.diaryEntry.create({
      data: {
        userId,
        entryDate: this.date(dto.entryDate),
        mealSlot: dto.mealSlot,
        customSlotName: dto.mealSlot === "custom" ? (dto.customSlotName ?? null) : null,
        status: dto.status,
        itemType: "recipe",
        recipeId: recipe.id,
        quantity: dto.quantity,
        unit: "serving",
        grams: snapshot.basis.grams || null,
        nutritionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        note: dto.note ?? null,
      },
    });
  }

  private async createFromMealGroup(userId: string, dto: CreateDiaryEntryDto): Promise<DiaryEntry[]> {
    const group = await this.prisma.mealGroup.findFirst({
      where: { id: dto.mealGroupId!, userId, deletedAt: null },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!group) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    const entries: DiaryEntry[] = [];
    for (const item of group.items) {
      const childDto: CreateDiaryEntryDto = {
        entryDate: dto.entryDate,
        mealSlot: dto.mealSlot,
        ...(dto.customSlotName !== undefined ? { customSlotName: dto.customSlotName } : {}),
        status: dto.status,
        itemType: item.itemType === "food" ? "food" : "recipe",
        ...(item.foodId ? { foodId: item.foodId } : {}),
        ...(item.recipeId ? { recipeId: item.recipeId } : {}),
        quantity: Number(item.quantity) * dto.quantity,
        unit: item.unit as CreateDiaryEntryDto["unit"],
      };
      const created =
        childDto.itemType === "food"
          ? await this.createFoodEntry(userId, childDto)
          : await this.createRecipeEntry(userId, childDto);
      const stamped = await this.prisma.diaryEntry.update({
        where: { id: created.id },
        data: { mealGroupId: group.id },
      });
      entries.push(stamped);
    }
    return entries;
  }

  async update(userId: string, id: string, dto: UpdateDiaryEntryDto): Promise<DiaryEntry> {
    const entry = await this.prisma.diaryEntry.findFirst({ where: { id, userId, deletedAt: null } });
    if (!entry) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });

    let snapshotUpdate: Prisma.DiaryEntryUpdateInput = {};
    if (dto.quantity !== undefined && dto.quantity !== Number(entry.quantity)) {
      // Rebuild from the PINNED version — never the current release.
      const { snapshot, grams } = await this.snapshots.rebuildFromPinned(
        entry.nutritionSnapshot as unknown as NutritionSnapshot,
        dto.quantity,
      );
      snapshotUpdate = {
        quantity: dto.quantity,
        grams,
        nutritionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      };
    }

    return this.prisma.diaryEntry.update({
      where: { id },
      data: {
        ...snapshotUpdate,
        ...(dto.entryDate !== undefined ? { entryDate: this.date(dto.entryDate) } : {}),
        ...(dto.mealSlot !== undefined ? { mealSlot: dto.mealSlot } : {}),
        ...(dto.customSlotName !== undefined ? { customSlotName: dto.customSlotName } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const updated = await this.prisma.diaryEntry.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
  }

  async restore(userId: string, id: string): Promise<DiaryEntry> {
    const updated = await this.prisma.diaryEntry.updateMany({
      where: { id, userId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (updated.count === 0) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    return this.prisma.diaryEntry.findFirstOrThrow({ where: { id } });
  }

  /** Clone a day (or one slot) onto another date, snapshots carried verbatim. */
  async copy(userId: string, dto: CopyDiaryDto): Promise<{ copied: number }> {
    const entries = await this.prisma.diaryEntry.findMany({
      where: {
        userId,
        entryDate: this.date(dto.fromDate),
        deletedAt: null,
        ...(dto.mealSlot ? { mealSlot: dto.mealSlot } : {}),
      },
    });
    for (const entry of entries) {
      await this.prisma.diaryEntry.create({
        data: {
          userId,
          entryDate: this.date(dto.toDate),
          mealSlot: entry.mealSlot,
          customSlotName: entry.customSlotName,
          status: dto.asPlanned ? "planned" : entry.status,
          itemType: entry.itemType,
          foodId: entry.foodId,
          recipeId: entry.recipeId,
          mealGroupId: entry.mealGroupId,
          quantity: entry.quantity,
          unit: entry.unit,
          grams: entry.grams,
          nutritionSnapshot: entry.nutritionSnapshot as Prisma.InputJsonValue,
          note: entry.note,
        },
      });
    }
    return { copied: entries.length };
  }

  /** Day view: entries by slot, per-slot + day totals, target comparison. */
  async day(userId: string, dateStr: string) {
    const entries = await this.prisma.diaryEntry.findMany({
      where: { userId, entryDate: this.date(dateStr), deletedAt: null },
      orderBy: { loggedAt: "asc" },
    });
    const consumed = entries.filter((e) => e.status === "consumed");
    const slots: Record<string, { entries: DiaryEntry[]; totals: Record<string, number> }> = {};
    for (const entry of entries) {
      const slotKey = entry.mealSlot === "custom" ? `custom:${entry.customSlotName ?? ""}` : entry.mealSlot;
      slots[slotKey] ??= { entries: [], totals: {} };
      slots[slotKey]!.entries.push(entry);
    }
    for (const slot of Object.values(slots)) {
      slot.totals = sumSnapshotNutrients(
        slot.entries
          .filter((e) => e.status === "consumed")
          .map((e) => e.nutritionSnapshot as unknown as NutritionSnapshot),
      );
    }
    const dayTotals = sumSnapshotNutrients(
      consumed.map((e) => e.nutritionSnapshot as unknown as NutritionSnapshot),
    );
    const plannedTotals = sumSnapshotNutrients(
      entries
        .filter((e) => e.status === "planned")
        .map((e) => e.nutritionSnapshot as unknown as NutritionSnapshot),
    );

    // Compare with the active calculation target.
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    let target: { targetKcal: number; macros: Record<string, number> } | null = null;
    if (profile?.activeCalcSnapshotId) {
      const calc = await this.prisma.calculationSnapshot.findUnique({
        where: { id: profile.activeCalcSnapshotId },
      });
      const outputs = calc?.outputs as { targetKcal?: number; macros?: Record<string, number> } | undefined;
      if (outputs?.targetKcal) {
        target = { targetKcal: outputs.targetKcal, macros: outputs.macros ?? {} };
      }
    }
    const consumedKcal = dayTotals.energy_kcal ?? 0;
    return {
      date: dateStr,
      slots,
      dayTotals,
      plannedTotals,
      target,
      remainingKcal: target ? Math.round(target.targetKcal - consumedKcal) : null,
    };
  }
}
