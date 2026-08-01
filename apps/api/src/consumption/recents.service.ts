import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "@hh/auth";
import type { FoodSearchCard } from "@hh/contracts";
import { PrismaService } from "../infra/prisma.service";

const MAX_RECENTS = 50;

/**
 * Recently-logged foods live in a Redis sorted set (score = last log time),
 * rebuilt lazily from the diary when cold. No table — this is cache-shaped
 * data with a natural source of truth.
 */
@Injectable()
export class RecentsService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private key(userId: string): string {
    return `recents:${userId}`;
  }

  async touch(userId: string, foodId: string): Promise<void> {
    const key = this.key(userId);
    await this.redis.zadd(key, Date.now(), foodId);
    await this.redis.zremrangebyrank(key, 0, -(MAX_RECENTS + 1));
    await this.redis.expire(key, 90 * 86_400);
  }

  async list(userId: string, limit = 20): Promise<FoodSearchCard[]> {
    const key = this.key(userId);
    let foodIds = await this.redis.zrevrange(key, 0, limit - 1);
    if (foodIds.length === 0) {
      // Cold cache: rebuild from the diary's newest food entries.
      const entries = await this.prisma.diaryEntry.findMany({
        where: { userId, itemType: "food", foodId: { not: null }, deletedAt: null },
        orderBy: { loggedAt: "desc" },
        take: MAX_RECENTS,
        select: { foodId: true, loggedAt: true },
      });
      const seen = new Set<string>();
      for (const entry of entries) {
        if (entry.foodId && !seen.has(entry.foodId)) {
          seen.add(entry.foodId);
          await this.redis.zadd(key, entry.loggedAt.getTime(), entry.foodId);
        }
      }
      foodIds = await this.redis.zrevrange(key, 0, limit - 1);
    }
    if (foodIds.length === 0) return [];

    const versions = await this.prisma.foodVersion.findMany({
      where: { foodId: { in: foodIds }, isInActiveRelease: true },
    });
    const byFoodId = new Map(versions.map((v) => [v.foodId, v]));
    return foodIds
      .map((foodId) => byFoodId.get(foodId))
      .filter((v): v is NonNullable<typeof v> => v !== undefined)
      .map((v) => ({
        id: v.id,
        foodId: v.foodId,
        slug: v.slug,
        nameAr: v.nameAr,
        nameEn: v.nameEn,
        brandName: v.brandName,
        categorySlug: v.categorySlug,
        foodType: v.foodType,
        preparationState: v.preparationState,
        energyKcalPer100g: (v.nutrients as Record<string, number>)?.energy_kcal ?? null,
        proteinGPer100g: (v.nutrients as Record<string, number>)?.protein_g ?? null,
        defaultPortionGrams: v.defaultPortionGrams ? Number(v.defaultPortionGrams) : null,
        imageRef: Array.isArray(v.imageRefs) ? ((v.imageRefs as unknown[])[0] ?? null) : null,
        matchTier: 0,
      }));
  }
}
