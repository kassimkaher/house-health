import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditAdminController } from "./audit.admin.controller";
import { CalcPoliciesAdminController, CalcPoliciesAdminService } from "./calc-policies.admin.controller";
import { JobsAdminController } from "./jobs.admin.controller";
import { SystemAdminController } from "./system.admin.controller";

@Module({
  imports: [AuthModule],
  controllers: [AuditAdminController, JobsAdminController, SystemAdminController, CalcPoliciesAdminController],
  providers: [CalcPoliciesAdminService],
})
export class AdminOpsModule {}
