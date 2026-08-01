import { Global, Module } from "@nestjs/common";
import { APP_CONFIG, loadConfig } from "@hh/config";

/**
 * Loads and validates env config once per process and exposes it under the
 * APP_CONFIG token. Config problems abort boot with a readable message.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
