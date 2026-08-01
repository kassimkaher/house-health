import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AUTH_GUARD_OPTIONS, JwtAuthGuard, PermissionsGuard, REDIS } from "@hh/auth";
import { APP_CONFIG, type AppConfig } from "@hh/config";
import type Redis from "ioredis";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health/health.controller";
import { ApiThrottlerGuard } from "./infra/api-throttler.guard";
import { AppConfigModule } from "./infra/config.module";
import { DatabaseModule } from "./infra/database.module";
import { RedisModule } from "./infra/redis.module";
import { RedisThrottlerStorage } from "./infra/throttler-redis.storage";

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, REDIS],
      useFactory: (config: AppConfig, redis: Redis) => ({
        throttlers: [
          {
            name: "general",
            ttl: 60_000,
            limit: config.nodeEnv === "test" ? 100_000 : 120,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: AUTH_GUARD_OPTIONS,
      useFactory: (config: AppConfig) => ({ jwtPublicKeyPem: config.jwtPublicKeyPem }),
      inject: [APP_CONFIG],
    },
    // Guard order matters: rate limiting → authentication → authorization.
    { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
