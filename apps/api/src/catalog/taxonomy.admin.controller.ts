import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermission, type RequestUser } from "@hh/auth";
import {
  ERROR_CODES,
  ZodValidationPipe,
  upsertBrandSchema,
  upsertCategorySchema,
  upsertNutrientDefinitionSchema,
  type UpsertBrandDto,
  type UpsertCategoryDto,
  type UpsertNutrientDefinitionDto,
} from "@hh/contracts";
import type { Brand, FoodCategory, NutrientDefinition } from "@hh/database";
import { AuditService } from "../auth/audit.service";
import { PrismaService } from "../infra/prisma.service";

/** Categories, brands, and nutrient definitions — small admin CRUD surfaces. */
@ApiTags("admin/catalog")
@ApiBearerAuth()
@Controller("admin/catalog")
export class TaxonomyAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // --- Categories ---------------------------------------------------------

  @Get("categories")
  @RequirePermission("foods.read")
  @ApiOperation({ summary: "Full category tree (flat, parentId links)" })
  listCategories(): Promise<FoodCategory[]> {
    return this.prisma.foodCategory.findMany({ orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }] });
  }

  @Post("categories")
  @RequirePermission("foods.write")
  async createCategory(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(upsertCategorySchema)) dto: UpsertCategoryDto,
  ): Promise<FoodCategory> {
    const existing = await this.prisma.foodCategory.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException({ code: ERROR_CODES.CATALOG_SLUG_TAKEN });
    const category = await this.prisma.foodCategory.create({
      data: { ...dto, parentId: dto.parentId ?? null },
    });
    await this.audit.append({ actorId: user.userId, action: "category.create", entityType: "food_category", entityId: category.id, after: dto });
    return category;
  }

  @Patch("categories/:id")
  @RequirePermission("foods.write")
  async updateCategory(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertCategorySchema.partial())) dto: Partial<UpsertCategoryDto>,
  ): Promise<FoodCategory> {
    const data = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const category = await this.prisma.foodCategory.update({ where: { id }, data });
    await this.audit.append({ actorId: user.userId, action: "category.update", entityType: "food_category", entityId: id, after: data });
    return category;
  }

  // --- Brands -------------------------------------------------------------

  @Get("brands")
  @RequirePermission("foods.read")
  listBrands(): Promise<Brand[]> {
    return this.prisma.brand.findMany({ orderBy: { nameEn: "asc" } });
  }

  @Post("brands")
  @RequirePermission("foods.write")
  async createBrand(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(upsertBrandSchema)) dto: UpsertBrandDto,
  ): Promise<Brand> {
    const existing = await this.prisma.brand.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException({ code: ERROR_CODES.CATALOG_SLUG_TAKEN });
    const brand = await this.prisma.brand.create({
      data: {
        slug: dto.slug,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        manufacturer: dto.manufacturer ?? null,
        countryCode: dto.countryCode ?? null,
      },
    });
    await this.audit.append({ actorId: user.userId, action: "brand.create", entityType: "brand", entityId: brand.id, after: dto });
    return brand;
  }

  @Patch("brands/:id")
  @RequirePermission("foods.write")
  async updateBrand(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertBrandSchema.partial())) dto: Partial<UpsertBrandDto>,
  ): Promise<Brand> {
    const data = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const brand = await this.prisma.brand.update({ where: { id }, data });
    await this.audit.append({ actorId: user.userId, action: "brand.update", entityType: "brand", entityId: id, after: data });
    return brand;
  }

  // --- Nutrient definitions ----------------------------------------------

  @Get("nutrients")
  @RequirePermission("foods.read")
  listNutrients(): Promise<NutrientDefinition[]> {
    return this.prisma.nutrientDefinition.findMany({ orderBy: { displayOrder: "asc" } });
  }

  @Post("nutrients")
  @HttpCode(200)
  @RequirePermission("foods.write")
  @ApiOperation({ summary: "Create or update a nutrient definition by key" })
  async upsertNutrient(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(upsertNutrientDefinitionSchema)) dto: UpsertNutrientDefinitionDto,
  ): Promise<NutrientDefinition> {
    const nutrient = await this.prisma.nutrientDefinition.upsert({
      where: { key: dto.key },
      update: dto,
      create: dto,
    });
    await this.audit.append({ actorId: user.userId, action: "nutrient.upsert", entityType: "nutrient_definition", entityId: nutrient.id, after: dto });
    return nutrient;
  }
}
