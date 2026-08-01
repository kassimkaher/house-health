import { Global, Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@hh/config";
import { OBJECT_STORAGE, S3ObjectStorage } from "@hh/storage";

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
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
