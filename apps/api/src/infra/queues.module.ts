import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { APP_CONFIG, type AppConfig } from "@hh/config";
import { QUEUES, QUEUE_PREFIX } from "@hh/pipeline";

export const IMPORTS_QUEUE = "IMPORTS_QUEUE";
export const CATALOG_QUEUE = "CATALOG_QUEUE";
export const REMINDERS_QUEUE = "REMINDERS_QUEUE";

function makeQueue(name: string, config: AppConfig): Queue {
  return new Queue(name, {
    prefix: QUEUE_PREFIX,
    connection: { url: config.redisUrl },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 7 * 86_400 },
    },
  });
}

/**
 * Queue PRODUCERS only — processors live exclusively in apps/worker.
 * REMINDERS_QUEUE is registered here read/monitoring-only (the worker owns
 * scheduling); BullMQ Queue clients are safe to share across processes.
 */
@Global()
@Module({
  providers: [
    {
      provide: IMPORTS_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => makeQueue(QUEUES.imports, config),
    },
    {
      provide: CATALOG_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => makeQueue(QUEUES.catalog, config),
    },
    {
      provide: REMINDERS_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => makeQueue(QUEUES.reminders, config),
    },
    {
      provide: "QUEUE_SHUTDOWN",
      inject: [IMPORTS_QUEUE, CATALOG_QUEUE, REMINDERS_QUEUE],
      useFactory: (...queues: Queue[]): OnApplicationShutdown => ({
        onApplicationShutdown: async () => {
          await Promise.all(queues.map((q) => q.close()));
        },
      }),
    },
  ],
  exports: [IMPORTS_QUEUE, CATALOG_QUEUE, REMINDERS_QUEUE],
})
export class QueuesModule {}
