import { Module } from "@nestjs/common";
import { CalcController } from "./calc.controller";
import { CalcService } from "./calc.service";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";

@Module({
  controllers: [ProfileController, CalcController],
  providers: [ProfileService, CalcService],
})
export class ProfileModule {}
