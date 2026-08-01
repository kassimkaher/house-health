import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type RequestUser } from "@hh/auth";
import {
  ZodValidationPipe,
  copyDiarySchema,
  createDiaryEntrySchema,
  createRecipeSchema,
  shortcutSchema,
  updateDiaryEntrySchema,
  updateRecipeSchema,
  upsertMealGroupSchema,
  type CopyDiaryDto,
  type CreateDiaryEntryDto,
  type CreateRecipeDto,
  type ShortcutDto,
  type UpdateDiaryEntryDto,
  type UpdateRecipeDto,
  type UpsertMealGroupDto,
} from "@hh/contracts";
import { z } from "zod";
import { PrismaService } from "../infra/prisma.service";
import type { DiaryEntry, UserShortcut } from "@hh/database";
import { DiaryService } from "./diary.service";
import { MealGroupsService, type MealGroupWithItems } from "./meal-groups.service";
import { RecentsService } from "./recents.service";
import { RecipesService, type RecipeTotals, type RecipeWithIngredients } from "./recipes.service";

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

@ApiTags("recipes")
@ApiBearerAuth()
@Controller("recipes")
export class RecipesController {
  constructor(@Inject(RecipesService) private readonly recipes: RecipesService) {}

  @Get()
  @ApiOperation({ summary: "My recipes (active)" })
  list(@CurrentUser() user: RequestUser, @Query("status") status?: string): Promise<RecipeWithIngredients[]> {
    return this.recipes.list(user.userId, status === "archived" ? "archived" : "active");
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<RecipeWithIngredients> {
    return this.recipes.get(user.userId, id);
  }

  @Post()
  @ApiOperation({ summary: "Create a recipe from structured foods; totals computed server-side" })
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createRecipeSchema)) dto: CreateRecipeDto,
  ): Promise<RecipeWithIngredients> {
    return this.recipes.create(user.userId, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRecipeSchema)) dto: UpdateRecipeDto,
  ): Promise<RecipeWithIngredients> {
    return this.recipes.update(user.userId, id, dto);
  }

  @Post(":id/duplicate")
  @HttpCode(201)
  duplicate(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<RecipeWithIngredients> {
    return this.recipes.duplicate(user.userId, id);
  }

  @Post(":id/archive")
  @HttpCode(200)
  async archive(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<{ id: string; status: string }> {
    const recipe = await this.recipes.setStatus(user.userId, id, "archived");
    return { id: recipe.id, status: recipe.status };
  }

  @Post(":id/restore")
  @HttpCode(200)
  async restore(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<{ id: string; status: string }> {
    const recipe = await this.recipes.setStatus(user.userId, id, "active");
    return { id: recipe.id, status: recipe.status };
  }

  @Get(":id/recalc-preview")
  @ApiOperation({ summary: "Preview totals against the current release without saving" })
  recalcPreview(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ current: RecipeTotals | null; recalculated: RecipeTotals; changedIngredients: string[] }> {
    return this.recipes.recalcPreview(user.userId, id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.recipes.softDelete(user.userId, id);
  }
}

@ApiTags("meal-groups")
@ApiBearerAuth()
@Controller("meal-groups")
export class MealGroupsController {
  constructor(@Inject(MealGroupsService) private readonly groups: MealGroupsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<MealGroupWithItems[]> {
    return this.groups.list(user.userId);
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<MealGroupWithItems> {
    return this.groups.get(user.userId, id);
  }

  @Get(":id/totals")
  @ApiOperation({ summary: "Live nutrition totals for the group (current release)" })
  totals(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<Record<string, number>> {
    return this.groups.totals(user.userId, id);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(upsertMealGroupSchema)) dto: UpsertMealGroupDto,
  ): Promise<MealGroupWithItems> {
    return this.groups.create(user.userId, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertMealGroupSchema)) dto: UpsertMealGroupDto,
  ): Promise<MealGroupWithItems> {
    return this.groups.update(user.userId, id, dto);
  }

  @Post(":id/duplicate")
  @HttpCode(201)
  duplicate(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<MealGroupWithItems> {
    return this.groups.duplicate(user.userId, id);
  }

  @Post(":id/restore")
  @HttpCode(200)
  restore(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<MealGroupWithItems> {
    return this.groups.restore(user.userId, id);
  }

  @Delete(":id")
  @HttpCode(204)
  async archive(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.groups.archive(user.userId, id);
  }
}

@ApiTags("diary")
@ApiBearerAuth()
@Controller("diary")
export class DiaryController {
  constructor(@Inject(DiaryService) private readonly diary: DiaryService) {}

  @Post("entries")
  @ApiOperation({ summary: "Log a food, recipe serving, or whole meal group" })
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createDiaryEntrySchema)) dto: CreateDiaryEntryDto,
  ): Promise<DiaryEntry[]> {
    return this.diary.create(user.userId, dto);
  }

  @Patch("entries/:id")
  @ApiOperation({ summary: "Edit quantity/slot/date/status; snapshots rebuild from the pinned version" })
  update(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDiaryEntrySchema)) dto: UpdateDiaryEntryDto,
  ): Promise<DiaryEntry> {
    return this.diary.update(user.userId, id, dto);
  }

  @Delete("entries/:id")
  @HttpCode(204)
  async remove(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.diary.remove(user.userId, id);
  }

  @Post("entries/:id/restore")
  @HttpCode(200)
  restore(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<DiaryEntry> {
    return this.diary.restore(user.userId, id);
  }

  @Post("copy")
  @HttpCode(200)
  @ApiOperation({ summary: "Copy a day (or one slot) to another date" })
  copy(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(copyDiarySchema)) dto: CopyDiaryDto,
  ): Promise<{ copied: number }> {
    return this.diary.copy(user.userId, dto);
  }

  @Get("day/:date")
  @ApiOperation({ summary: "Entries by slot + totals + target comparison for a date" })
  day(
    @CurrentUser() user: RequestUser,
    @Param("date", new ZodValidationPipe(dateParam)) date: string,
  ): ReturnType<DiaryService["day"]> {
    return this.diary.day(user.userId, date);
  }
}

@ApiTags("favorites")
@ApiBearerAuth()
@Controller()
export class FavoritesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RecentsService) private readonly recents: RecentsService,
  ) {}

  @Get("favorites")
  favorites(@CurrentUser() user: RequestUser): Promise<UserShortcut[]> {
    return this.prisma.userShortcut.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
    });
  }

  @Post("favorites")
  @HttpCode(200)
  async add(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(shortcutSchema)) dto: ShortcutDto,
  ): Promise<UserShortcut> {
    return this.prisma.userShortcut.upsert({
      where: {
        userId_entityType_entityId_kind: {
          userId: user.userId,
          entityType: dto.entityType,
          entityId: dto.entityId,
          kind: dto.kind,
        },
      },
      update: {},
      create: { userId: user.userId, entityType: dto.entityType, entityId: dto.entityId, kind: dto.kind },
    });
  }

  @Delete("favorites")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(shortcutSchema)) dto: ShortcutDto,
  ): Promise<void> {
    await this.prisma.userShortcut.deleteMany({
      where: { userId: user.userId, entityType: dto.entityType, entityId: dto.entityId, kind: dto.kind },
    });
  }

  @Get("recents")
  @ApiOperation({ summary: "Recently logged foods as search cards (fast home-screen path)" })
  recentFoods(@CurrentUser() user: RequestUser): ReturnType<RecentsService["list"]> {
    return this.recents.list(user.userId);
  }
}
