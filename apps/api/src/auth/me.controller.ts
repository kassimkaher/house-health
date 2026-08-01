import { Controller, Get, Inject } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type RequestUser } from "@hh/auth";
import { type UserView } from "@hh/contracts";
import { AuthService } from "./auth.service";

@ApiTags("me")
@Controller("me")
export class MeController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Current user profile view" })
  me(@CurrentUser() user: RequestUser): Promise<UserView> {
    return this.auth.getMe(user.userId);
  }
}
