import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ImportsAdminController } from "./imports.admin.controller";
import { ReleasesAdminController } from "./releases.admin.controller";

@Module({
  imports: [AuthModule],
  controllers: [ImportsAdminController, ReleasesAdminController],
})
export class PipelineAdminModule {}
