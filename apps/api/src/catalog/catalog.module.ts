import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DuplicatesAdminController } from "./duplicates.admin.controller";
import { FoodsAdminController } from "./foods.admin.controller";
import { FoodsService } from "./foods.service";
import { TaxonomyAdminController } from "./taxonomy.admin.controller";

@Module({
  imports: [AuthModule],
  controllers: [FoodsAdminController, TaxonomyAdminController, DuplicatesAdminController],
  providers: [FoodsService],
  exports: [FoodsService],
})
export class CatalogModule {}
