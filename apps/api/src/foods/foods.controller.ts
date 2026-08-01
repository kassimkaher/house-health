import { BadRequestException, Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public, type RequestUser } from "@hh/auth";
import {
  ERROR_CODES,
  ZodValidationPipe,
  searchFoodsQuerySchema,
  type FoodDetailView,
  type FoodSearchCard,
  type FoodSearchResult,
  type SearchFoodsQuery,
} from "@hh/contracts";
import { PublicFoodsService } from "./foods.service";

/**
 * Public read surface over the ACTIVE dataset release only. Search returns
 * compact cards; the detail endpoint carries full nutrients/portions.
 */
@ApiTags("foods")
@Public()
@Controller("foods")
export class FoodsController {
  constructor(@Inject(PublicFoodsService) private readonly foods: PublicFoodsService) {}

  @Get("search")
  @ApiOperation({ summary: "Arabic-first food search (exact > prefix > full-text > fuzzy)" })
  search(
    @Query(new ZodValidationPipe(searchFoodsQuerySchema)) query: SearchFoodsQuery,
    @Req() req: { user?: RequestUser },
  ): Promise<FoodSearchResult> {
    return this.foods.search(query, req.user?.userId ?? null);
  }

  @Get("barcode/:code")
  @ApiOperation({ summary: "Exact barcode lookup" })
  barcode(@Param("code") code: string): Promise<FoodSearchCard> {
    if (!/^[0-9]{6,14}$/.test(code)) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        fields: [{ path: "code", message: "must be 6-14 digits" }],
      });
    }
    return this.foods.byBarcode(code);
  }

  @Get(":idOrSlug")
  @ApiOperation({ summary: "Full food detail from the active release" })
  detail(@Param("idOrSlug") idOrSlug: string): Promise<FoodDetailView> {
    return this.foods.detail(idOrSlug);
  }
}
