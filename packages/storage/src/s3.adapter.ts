import type { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  Bucket,
  ObjectStorage,
  PresignGetOptions,
  PresignPutOptions,
  PutObjectOptions,
} from "./port";

export interface S3AdapterConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  /** Prefix so multiple stacks (dev/staging/prod) can share one MinIO. */
  bucketPrefix?: string;
}

const ALL_BUCKETS: Bucket[] = ["food-images", "user-uploads", "imports", "exports"];

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(config: S3AdapterConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? "us-east-1",
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true, // MinIO requirement; harmless on AWS
    });
    this.prefix = config.bucketPrefix ?? "hh";
  }

  private bucketName(bucket: Bucket): string {
    return `${this.prefix}-${bucket}`;
  }

  async ensureBuckets(): Promise<void> {
    for (const bucket of ALL_BUCKETS) {
      const name = this.bucketName(bucket);
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: name }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: name }));
      }
    }
  }

  async putObject(
    bucket: Bucket,
    key: string,
    body: Buffer | Readable,
    opts: PutObjectOptions,
  ): Promise<{ etag: string | null }> {
    const res = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        Metadata: opts.metadata,
      }),
    );
    return { etag: res.ETag ?? null };
  }

  async getObject(bucket: Bucket, key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`object ${bucket}/${key} has no body`);
    return Buffer.from(bytes);
  }

  async deleteObject(bucket: Bucket, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
  }

  async objectExists(bucket: Bucket, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  presignedPutUrl(bucket: Bucket, key: string, opts: PresignPutOptions): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucketName(bucket), Key: key, ContentType: opts.contentType }),
      { expiresIn: opts.expiresSec },
    );
  }

  presignedGetUrl(bucket: Bucket, key: string, opts: PresignGetOptions): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      { expiresIn: opts.expiresSec },
    );
  }
}
