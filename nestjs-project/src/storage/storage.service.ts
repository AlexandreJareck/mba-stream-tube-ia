import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { StorageUnavailableException } from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import {
  StorageObjectNotFoundError,
  StorageUploadNotFoundError,
} from './storage.errors';

export interface UploadedPart {
  partNumber: number;
  size: number;
  etag: string;
}

export interface ObjectHead {
  size: number;
  contentType: string | undefined;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface ObjectStream {
  body: Readable;
  contentLength: number;
}

interface S3ErrorShape {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

/**
 * S3/MinIO adapter shared by the API and the worker (phase-03-videos/TD-03).
 * `client` talks to the internal endpoint (Compose service name);
 * `presignClient` only signs URLs for clients outside Docker.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    config: ConfigType<typeof storageConfig>,
  ) {
    const base = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.client = new S3Client({ ...base, endpoint: config.endpoint });
    this.presignClient = new S3Client({
      ...base,
      endpoint: config.publicEndpoint,
    });
    this.bucket = config.bucket;
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.call(key, () =>
      this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: contentType,
        }),
      ),
    );
    if (!result.UploadId) {
      throw new StorageUnavailableException();
    }
    return result.UploadId;
  }

  /** Presigned `UploadPart` URL for a client outside Docker (TD-02). */
  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    for (;;) {
      const page = await this.call(key, () =>
        this.client.send(
          new ListPartsCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        ),
      );
      for (const part of page.Parts ?? []) {
        parts.push({
          partNumber: part.PartNumber ?? 0,
          size: part.Size ?? 0,
          etag: part.ETag ?? '',
        });
      }
      if (!page.IsTruncated || !page.NextPartNumberMarker) break;
      marker = page.NextPartNumberMarker;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void> {
    await this.call(key, () =>
      this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      ),
    );
  }

  /** Idempotent: an upload that no longer exists counts as aborted. */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.call(key, () =>
        this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
          }),
        ),
      );
    } catch (error) {
      if (error instanceof StorageUploadNotFoundError) return;
      throw error;
    }
  }

  async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const head = await this.call(key, () =>
        this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        ),
      );
      return { size: head.ContentLength ?? 0, contentType: head.ContentType };
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) return null;
      throw error;
    }
  }

  /** Streams the object (or one byte range of it) without buffering. */
  async getObjectStream(key: string, range?: ByteRange): Promise<ObjectStream> {
    const result = await this.call(key, () =>
      this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      ),
    );
    return {
      body: result.Body as Readable,
      contentLength: result.ContentLength ?? 0,
    };
  }

  async putObject(
    key: string,
    body: Buffer | Readable,
    contentType: string,
    contentLength?: number,
  ): Promise<void> {
    await this.call(key, () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: contentLength,
        }),
      ),
    );
  }

  /** Short-lived GET URL on the internal endpoint, read by ffprobe/ffmpeg (TD-04). */
  async presignInternalGet(
    key: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  /**
   * Translates S3 SDK failures: "not found" outcomes become storage errors the
   * caller decides on; network/5xx failures become 503 STORAGE_UNAVAILABLE.
   */
  private async call<T>(key: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const s3Error = error as S3ErrorShape;
      if (s3Error.name === 'NoSuchUpload') {
        throw new StorageUploadNotFoundError(key);
      }
      if (s3Error.name === 'NoSuchKey' || s3Error.name === 'NotFound') {
        throw new StorageObjectNotFoundError(key);
      }
      const status = s3Error.$metadata?.httpStatusCode;
      if (status === undefined || status >= 500) {
        this.logger.error(
          `Storage call failed for ${key}: ${s3Error.name ?? 'UnknownError'}`,
        );
        throw new StorageUnavailableException();
      }
      throw error;
    }
  }
}
