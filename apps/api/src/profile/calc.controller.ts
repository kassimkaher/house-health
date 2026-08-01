import { Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type RequestUser } from "@hh/auth";
import { type CalcSnapshotView } from "@hh/contracts";
import { CalcService } from "./calc.service";

@ApiTags("calc")
@ApiBearerAuth()
@Controller("me/calc")
export class CalcController {
  constructor(@Inject(CalcService) private readonly calc: CalcService) {}

  @Post("estimate")
  @HttpCode(200)
  @ApiOperation({ summary: "Compute calorie/macro targets from the profile; persists an immutable snapshot" })
  estimate(@CurrentUser() user: RequestUser): Promise<CalcSnapshotView> {
    return this.calc.estimate(user.userId);
  }

  @Get("current")
  @ApiOperation({ summary: "Active calculation snapshot (null when none computed yet)" })
  current(@CurrentUser() user: RequestUser): Promise<CalcSnapshotView | null> {
    return this.calc.current(user.userId);
  }

  @Get("history")
  @ApiOperation({ summary: "Past calculation snapshots, newest first" })
  history(@CurrentUser() user: RequestUser): Promise<CalcSnapshotView[]> {
    return this.calc.history(user.userId);
  }
}
