import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FoodsAdminController } from "./foods.admin.controller";
import { FoodsService } from "./foods.service";
import { TaxonomyAdminController } from "./taxonomy.admin.controller";

@Module({
  imports: [AuthModule],
  controllers: [FoodsAdminController, TaxonomyAdminController],
  providers: [FoodsService],
  exports: [FoodsService],
})
export class CatalogModule {}
