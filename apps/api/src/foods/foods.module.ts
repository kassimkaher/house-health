import { Module } from "@nestjs/common";
import { FoodSearchRepository } from "./food-search.repository";
import { FoodsController } from "./foods.controller";
import { PublicFoodsService } from "./foods.service";

@Module({
  controllers: [FoodsController],
  providers: [PublicFoodsService, FoodSearchRepository],
  exports: [PublicFoodsService],
})
export class FoodsModule {}
