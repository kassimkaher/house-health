import { Module } from "@nestjs/common";
import {
  DiaryController,
  FavoritesController,
  MealGroupsController,
  RecipesController,
} from "./consumption.controllers";
import { DiaryService } from "./diary.service";
import { MealGroupsService } from "./meal-groups.service";
import { RecentsService } from "./recents.service";
import { RecipesService } from "./recipes.service";
import { SnapshotResolverService } from "./snapshot-resolver.service";

@Module({
  controllers: [RecipesController, MealGroupsController, DiaryController, FavoritesController],
  providers: [SnapshotResolverService, RecipesService, MealGroupsService, DiaryService, RecentsService],
  exports: [DiaryService, RecentsService],
})
export class ConsumptionModule {}
