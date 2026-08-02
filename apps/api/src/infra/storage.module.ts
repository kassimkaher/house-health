import { Global, Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@hh/config";
import { OBJECT_STORAGE, S3ObjectStorage, type ObjectStorage } from "@hh/storage";

/** Ensures every bucket the app needs exists before serving traffic — both
 *  for the health check and for uploads/imports to work at all. */
@Injectable()
class BucketBootstrap implements OnModuleInit {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  async onModuleInit(): Promise<void> {
    await this.storage.ensureBuckets();
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
