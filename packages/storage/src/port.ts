import type { Readable } from "node:stream";

export type Bucket = "food-images" | "user-uploads" | "imports" | "exports";

export interface PutObjectOptions {
  contentType: string;
  metadata?: Record<string, string>;
}

export interface PresignPutOptions {
  contentType: string;
  expiresSec: number;
}

export interface PresignGetOptions {
  expiresSec: number;
}

/**
 * Provider-neutral object-storage port. The MinIO implementation speaks the
 * S3 API with forcePathStyle, so swapping the endpoint moves the platform to
 * any S3-compatible provider without code changes.
 */
export interface ObjectStorage {
  putObject(bucket: Bucket, key: string, body: Buffer | Readable, opts: PutObjectOptions): Promise<{ etag: string | null }>;
  getObject(bucket: Bucket, key: string): Promise<Buffer>;
  deleteObject(bucket: Bucket, key: string): Promise<void>;
  objectExists(bucket: Bucket, key: string): Promise<boolean>;
  presignedPutUrl(bucket: Bucket, key: string, opts: PresignPutOptions): Promise<string>;
  presignedGetUrl(bucket: Bucket, key: string, opts: PresignGetOptions): Promise<string>;
  ensureBuckets(): Promise<void>;
}

/** Nest injection token for the ObjectStorage port. */
export const OBJECT_STORAGE = "OBJECT_STORAGE";
