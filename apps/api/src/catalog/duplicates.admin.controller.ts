import { Body, Controller, Get, HttpCode, Inject, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermission, type RequestUser } from "@hh/auth";
import {
  ZodValidationPipe,
  findDuplicatesQuerySchema,
  mergeFoodsSchema,
  type FindDuplicatesQuery,
  type MergeFoodsDto,
} from "@hh/contracts";
import { FoodsService, type AdminFood } from "./foods.service";

@ApiTags("admin/duplicates")
@ApiBearerAuth()
@Controller("admin/catalog/duplicates")
export class DuplicatesAdminController {
  constructor(@Inject(FoodsService) private readonly foods: FoodsService) {}

  @Get()
  @RequirePermission("foods.merge")
  @ApiOperation({ summary: "Candidate duplicate food pairs ranked by name similarity" })
  find(@Query(new ZodValidationPipe(findDuplicatesQuerySchema)) query: FindDuplicatesQuery) {
    return this.foods.findDuplicates(query.threshold, query.limit);
  }

  @Post("merge")
  @HttpCode(200)
  @RequirePermission("foods.merge")
  @ApiOperation({ summary: "Merge source food into target; source is archived, never deleted" })
  merge(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(mergeFoodsSchema)) dto: MergeFoodsDto,
  ): Promise<AdminFood> {
    return this.foods.merge(dto.sourceFoodId, dto.targetFoodId, dto.notes, user.userId);
  }
}
