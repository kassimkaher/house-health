import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermission, type RequestUser } from "@hh/auth";
import {
  ERROR_CODES,
  ZodValidationPipe,
  addAliasSchema,
  addBarcodeSchema,
  createFoodSchema,
  listFoodsQuerySchema,
  reviewTransitionSchema,
  setFoodNutrientsSchema,
  updateFoodSchema,
  upsertPortionSchema,
  type AddAliasDto,
  type AddBarcodeDto,
  type CreateFoodDto,
  type ListFoodsQuery,
  type ReviewTransitionDto,
  type SetFoodNutrientsDto,
  type UpdateFoodDto,
  type UpsertPortionDto,
} from "@hh/contracts";
import { FoodsService, type AdminFood } from "./foods.service";

function parseIfMatch(header: string | undefined): number {
  const version = Number(header);
  if (!header || !Number.isInteger(version) || version < 1) {
    throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      fields: [{ path: "If-Match", message: "must be the current rowVersion integer" }],
    });
  }
  return version;
}

@ApiTags("admin/catalog")
@ApiBearerAuth()
@Controller("admin/catalog/foods")
export class FoodsAdminController {
  constructor(@Inject(FoodsService) private readonly foods: FoodsService) {}

  @Get()
  @RequirePermission("foods.read")
  @ApiOperation({ summary: "List/search editorial foods (cursor-paginated)" })
  list(@Query(new ZodValidationPipe(listFoodsQuerySchema)) query: ListFoodsQuery) {
    return this.foods.list(query);
  }

  @Get(":id")
  @RequirePermission("foods.read")
  @ApiOperation({ summary: "Full editorial food record" })
  get(@Param("id", ParseUUIDPipe) id: string): Promise<AdminFood> {
    return this.foods.get(id);
  }

  @Post()
  @RequirePermission("foods.write")
  @ApiOperation({ summary: "Create a food (draft, imported state)" })
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createFoodSchema)) dto: CreateFoodDto,
  ): Promise<AdminFood> {
    return this.foods.create(dto, user.userId);
  }

  @Patch(":id")
  @RequirePermission("foods.write")
  @ApiOperation({ summary: "Update a food (If-Match: rowVersion required)" })
  update(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body(new ZodValidationPipe(updateFoodSchema)) dto: UpdateFoodDto,
  ): Promise<AdminFood> {
    return this.foods.update(id, parseIfMatch(ifMatch), dto, user.userId);
  }

  @Post(":id/transition")
  @HttpCode(200)
  @RequirePermission("foods.review")
  @ApiOperation({ summary: "Review-state transition (verify/reject/archive/...)" })
  transition(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reviewTransitionSchema)) dto: ReviewTransitionDto,
  ): Promise<AdminFood> {
    return this.foods.transition(id, dto, user.userId);
  }

  @Post(":id/nutrients")
  @HttpCode(200)
  @RequirePermission("foods.write")
  @ApiOperation({ summary: "Replace the per-100g nutrient set" })
  setNutrients(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setFoodNutrientsSchema)) dto: SetFoodNutrientsDto,
  ): Promise<AdminFood> {
    return this.foods.setNutrients(id, dto, user.userId);
  }

  @Post(":id/aliases")
  @HttpCode(200)
  @RequirePermission("foods.write")
  @ApiOperation({ summary: "Add a search alias (dialect/transliteration/...)" })
  addAlias(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addAliasSchema)) dto: AddAliasDto,
  ): Promise<AdminFood> {
    return this.foods.addAlias(id, dto, user.userId);
  }

  @Delete(":id/aliases/:aliasId")
  @HttpCode(204)
  @RequirePermission("foods.write")
  async removeAlias(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("aliasId", ParseUUIDPipe) aliasId: string,
  ): Promise<void> {
    await this.foods.removeAlias(id, aliasId, user.userId);
  }

  @Post(":id/barcodes")
  @HttpCode(200)
  @RequirePermission("foods.write")
  @ApiOperation({ summary: "Attach a barcode (globally unique among active)" })
  addBarcode(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addBarcodeSchema)) dto: AddBarcodeDto,
  ): Promise<AdminFood> {
    return this.foods.addBarcode(id, dto, user.userId);
  }

  @Delete(":id/barcodes/:barcodeId")
  @HttpCode(204)
  @RequirePermission("foods.write")
  async deactivateBarcode(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("barcodeId", ParseUUIDPipe) barcodeId: string,
  ): Promise<void> {
    await this.foods.deactivateBarcode(id, barcodeId, user.userId);
  }

  @Post(":id/portions")
  @HttpCode(200)
  @RequirePermission("foods.write")
  @ApiOperation({ summary: "Add a portion with verified gram weight" })
  addPortion(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertPortionSchema)) dto: UpsertPortionDto,
  ): Promise<AdminFood> {
    return this.foods.addPortion(id, dto, user.userId);
  }

  @Delete(":id/portions/:portionId")
  @HttpCode(204)
  @RequirePermission("foods.write")
  async removePortion(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("portionId", ParseUUIDPipe) portionId: string,
  ): Promise<void> {
    await this.foods.removePortion(id, portionId, user.userId);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("foods.write")
  @ApiOperation({ summary: "Soft-delete a food (audit-preserving)" })
  async remove(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.foods.softDelete(id, user.userId);
  }
}
