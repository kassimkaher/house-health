import { Global, Inject, Injectable, Logger, Module, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@hh/config";
import { OBJECT_STORAGE, S3ObjectStorage, type ObjectStorage } from "@hh/storage";

/** Ensures every bucket the app needs exists before serving traffic — both
 *  for the health check and for uploads/imports to work at all.
 *
 *  MinIO may not be reachable yet at boot (e.g. S3_ENDPOINT routes through
 *  Nginx, which starts after the api container per the compose dependency
 *  chain, or DNS for a fresh domain hasn't propagated). Don't let that
 *  crash the process — `/health/ready` already live-checks storage on
 *  every request, so logging and retrying on the next boot/healthcheck
 *  cycle is the correct degradation instead of a crash loop. */
@Injectable()
class BucketBootstrap implements OnModuleInit {
  private readonly logger = new Logger(BucketBootstrap.name);

  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.storage.ensureBuckets();
    } catch (err) {
      this.logger.warn(
        `Could not ensure object storage buckets at boot — will keep reporting not-ready until storage is reachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

@Global()
@Module({
  providers: [
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
    BucketBootstrap,
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
