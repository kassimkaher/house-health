import { Controller, Get, Inject } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "@hh/auth";
import type { MediaAsset } from "@hh/database";
import { PrismaService } from "../infra/prisma.service";

@ApiTags("admin/system")
@ApiBearerAuth()
@Controller("admin/system")
export class SystemAdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("overview")
  @RequirePermission("system.admin")
  @ApiOperation({ summary: "Dashboard landing counts: users, catalog, releases, imports" })
  async overview() {
    const [
      userCount,
      activeUserCount,
      foodCount,
      needsReviewCount,
      publishedFoodVersionCount,
      activeRelease,
      recentImportJobs,
      pendingMedia,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { status: "active" } }),
      this.prisma.food.count({ where: { deletedAt: null } }),
      this.prisma.food.count({ where: { reviewStatus: "needs_review", deletedAt: null } }),
      this.prisma.foodVersion.count({ where: { isInActiveRelease: true } }),
      this.prisma.datasetRelease.findFirst({ where: { isActive: true }, select: { version: true, publishedAt: true, foodCount: true } }),
      this.prisma.importJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, status: true, createdAt: true, mode: true },
      }),
      this.prisma.mediaAsset.count({ where: { status: "pending" } }),
    ]);
    return {
      users: { total: userCount, active: activeUserCount },
      catalog: { totalFoods: foodCount, needsReview: needsReviewCount, publishedInActiveRelease: publishedFoodVersionCount },
      activeRelease,
      recentImportJobs,
      pendingMediaAssets: pendingMedia,
    };
  }

  @Get("media")
  @RequirePermission("system.admin")
  @ApiOperation({ summary: "Recent media/storage assets and their status" })
  async media(): Promise<{ items: MediaAsset[]; pendingCount: number; rejectedCount: number }> {
    const [items, pendingCount, rejectedCount] = await Promise.all([
      this.prisma.mediaAsset.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.mediaAsset.count({ where: { status: "pending" } }),
      this.prisma.mediaAsset.count({ where: { status: "rejected" } }),
    ]);
    return { items, pendingCount, rejectedCount };
  }
}
