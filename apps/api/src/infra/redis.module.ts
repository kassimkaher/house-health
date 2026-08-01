import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@hh/config";
import { REDIS } from "@hh/auth";
import Redis from "ioredis";

/** Single shared ioredis client, exposed under the 'REDIS' token. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (config: AppConfig) =>
        new Redis(config.redisUrl, { maxRetriesPerRequest: 3, enableReadyCheck: true }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
