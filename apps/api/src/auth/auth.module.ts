import { Module } from "@nestjs/common";
import { EMAIL_PORT, LogEmailProvider } from "@hh/notifications";
import { AuditService } from "./audit.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MeController } from "./me.controller";
import { OidcService } from "./oidc.service";
import { SessionService } from "./session.service";
import { TokenService } from "./token.service";

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    TokenService,
    SessionService,
    OidcService,
    AuditService,
    { provide: EMAIL_PORT, useClass: LogEmailProvider },
  ],
  exports: [AuditService, SessionService],
})
export class AuthModule {}
