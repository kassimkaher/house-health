import { Module, type OnApplicationShutdown, type OnModuleInit, Inject, Injectable } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { APP_CONFIG, loadConfig, type AppConfig } from "@hh/config";
import { prisma } from "@hh/database";
import { LogPushProvider } from "@hh/notifications";
import {
  ImportRunner,
  QUEUES,
  QUEUE_PREFIX,
  ReleaseService,
  ReminderSweeper,
  jobIds,
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
  private remindersQueue: Queue | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = { url: this.config.redisUrl };
    const importRunner = new ImportRunner(prisma);
    const releases = new ReleaseService(prisma);
    const sweeper = new ReminderSweeper(prisma, new LogPushProvider());

    // Repeatable sweep every minute; dispatch jobs fan out per delivery.
    this.remindersQueue = new Queue(QUEUES.reminders, { prefix: QUEUE_PREFIX, connection });
    await this.remindersQueue.add(
      "sweep",
      {},
      {
        repeat: { every: 60_000 },
        jobId: "reminders-sweep",
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );
    this.workers.push(
      new Worker(
        QUEUES.reminders,
        async (job) => {
          if (job.name === "sweep") {
            const due = await sweeper.sweep();
            for (const dispatch of due) {
              await this.remindersQueue!.add("dispatch", dispatch, {
                jobId: jobIds.reminderDispatch(dispatch.reminderId, dispatch.scheduledFor.getTime()),
                attempts: 3,
                backoff: { type: "fixed", delay: 30_000 },
              });
            }
          } else if (job.name === "dispatch") {
            await sweeper.dispatch((job.data as { deliveryId: string }).deliveryId);
          }
        },
        { prefix: QUEUE_PREFIX, connection, concurrency: 2 },
      ),
    );

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
    await this.remindersQueue?.close();
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
