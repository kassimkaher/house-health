import { Module, type OnApplicationShutdown, type OnModuleInit, Inject, Injectable } from "@nestjs/common";
import { Worker } from "bullmq";
import { APP_CONFIG, loadConfig, type AppConfig } from "@hh/config";
import { prisma } from "@hh/database";
import {
  ImportRunner,
  QUEUES,
  QUEUE_PREFIX,
  ReleaseService,
  type ImportRunJobData,
  type ReleaseBuildJobData,
} from "@hh/pipeline";
import { OBJECT_STORAGE, S3ObjectStorage, type ObjectStorage } from "@hh/storage";

/**
 * Registers BullMQ processors. The api enqueues; only this process consumes.
 * Concurrency is deliberately low — a single shared server.
 */
@Injectable()
export class QueueWorkers implements OnModuleInit, OnApplicationShutdown {
  private workers: Worker[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onModuleInit(): void {
    const connection = { url: this.config.redisUrl };
    const importRunner = new ImportRunner(prisma);
    const releases = new ReleaseService(prisma);

    this.workers.push(
      new Worker<ImportRunJobData>(
        QUEUES.imports,
        async (job) => {
          const dbJob = await prisma.importJob.findUniqueOrThrow({
            where: { id: job.data.importJobId },
          });
          if (!dbJob.sourceFileKey) throw new Error(`import ${dbJob.id} has no source file`);
          const file = await this.storage.getObject("imports", dbJob.sourceFileKey);
          await importRunner.run(dbJob.id, file);
        },
        { prefix: QUEUE_PREFIX, connection, concurrency: 1 },
      ),
      new Worker<ReleaseBuildJobData>(
        QUEUES.catalog,
        async (job) => {
          if (job.name === "release-build") {
            await releases.buildCandidate(job.data.version, job.data.ownerId, job.data.notes);
          }
        },
        { prefix: QUEUE_PREFIX, connection, concurrency: 1 },
      ),
    );
    for (const worker of this.workers) {
      worker.on("failed", (job, err) => {
        console.error(`[worker] job ${job?.queueName}/${job?.id} failed: ${err.message}`);
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await prisma.$disconnect();
  }
}

@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new S3ObjectStorage({
          endpoint: config.s3.endpoint,
          accessKeyId: config.s3.accessKey,
          secretAccessKey: config.s3.secretKey,
          bucketPrefix: config.s3.bucketPrefix,
        }),
    },
    QueueWorkers,
  ],
})
export class WorkerModule {}
