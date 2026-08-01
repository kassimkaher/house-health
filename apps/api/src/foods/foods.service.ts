import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "@hh/auth";
import {
  ERROR_CODES,
  type FoodDetailView,
  type FoodSearchCard,
  type FoodSearchResult,
  type SearchFoodsQuery,
} from "@hh/contracts";
import { PrismaService } from "../infra/prisma.service";
import { FoodSearchRepository } from "./food-search.repository";

const SEARCH_CACHE_TTL_SEC = 120;

@Injectable()
export class PublicFoodsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FoodSearchRepository) private readonly searchRepo: FoodSearchRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async search(query: SearchFoodsQuery, userId: string | null): Promise<FoodSearchResult> {
    const releaseId = await this.activeReleaseId();
    if (!releaseId) {
      return { items: [], limit: query.limit, offset: query.offset, hasMore: false };
    }
    // Cache key includes the active release — publishing invalidates naturally.
    const cacheKey = `search:${releaseId}:${JSON.stringify(query)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as FoodSearchResult;
      void this.logQuery(query.q, parsed.items, userId);
      return parsed;
    }
    await this.searchRepo.prepareSession();
    const { items, hasMore } = await this.searchRepo.search(query);
    const result: FoodSearchResult = { items, limit: query.limit, offset: query.offset, hasMore };
    await this.redis.set(cacheKey, JSON.stringify(result), "EX", SEARCH_CACHE_TTL_SEC);
    void this.logQuery(query.q, items, userId);
    return result;
  }

  async byBarcode(code: string): Promise<FoodSearchCard> {
    const card = await this.searchRepo.byBarcode(code);
    if (!card) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    return card;
  }

  /** Detail by food-version id, food id, or slug — active release only. */
  async detail(idOrSlug: string): Promise<FoodDetailView> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const version = await this.prisma.foodVersion.findFirst({
      where: {
        isInActiveRelease: true,
        ...(isUuid ? { OR: [{ id: idOrSlug }, { foodId: idOrSlug }] } : { slug: idOrSlug }),
      },
    });
    if (!version) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND });
    const release = await this.prisma.datasetRelease.findFirst({
      where: { isActive: true },
      select: { version: true },
    });
    return {
      id: version.id,
      foodId: version.foodId,
      slug: version.slug,
      nameAr: version.nameAr,
      nameEn: version.nameEn,
      descriptionAr: version.descriptionAr,
      descriptionEn: version.descriptionEn,
      aliases: (version.aliasesDisplay as FoodDetailView["aliases"]) ?? [],
      brandName: version.brandName,
      categorySlug: version.categorySlug,
      categoryPath: version.categoryPath,
      foodType: version.foodType,
      preparationState: version.preparationState,
      barcodes: version.barcodes,
      defaultPortionGrams: version.defaultPortionGrams ? Number(version.defaultPortionGrams) : null,
      densityGPerMl: version.densityGPerMl ? Number(version.densityGPerMl) : null,
      marketTags: version.marketTags,
      dietaryTags: version.dietaryTags,
      allergenTags: version.allergenTags,
      imageRefs: version.imageRefs,
      nutrientsPer100g: (version.nutrients as Record<string, number>) ?? {},
      portions: (version.portions as FoodDetailView["portions"]) ?? [],
      dataConfidence: Number(version.dataConfidence),
      releaseVersion: release?.version ?? null,
    };
  }

  private async activeReleaseId(): Promise<string | null> {
    const cached = await this.redis.get("active-release-id");
    if (cached) return cached === "none" ? null : cached;
    const release = await this.prisma.datasetRelease.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    await this.redis.set("active-release-id", release?.id ?? "none", "EX", 30);
    return release?.id ?? null;
  }

  /** Fire-and-forget analytics: normalized term only, no free-text retention. */
  private async logQuery(q: string, items: FoodSearchCard[], userId: string | null): Promise<void> {
    try {
      const norm = await this.prisma.$queryRaw<Array<{ n: string }>>`SELECT normalize_arabic(${q}) AS n`;
      await this.prisma.searchQueryLog.create({
        data: {
          termNorm: norm[0]?.n ?? q.toLowerCase(),
          resultCount: items.length,
          pickedFoodId: null,
          userId,
        },
      });
    } catch {
      // analytics must never break search
    }
  }
}
