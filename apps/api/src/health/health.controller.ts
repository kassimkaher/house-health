import { Controller, Get } from "@nestjs/common";
import { Public } from "@hh/auth";

@Public()
@Controller("health")
export class HealthController {
  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }
}
