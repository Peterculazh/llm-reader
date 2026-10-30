import { OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  ObjectNotFoundError,
  ObjectStorage,
  StoredObject,
  StoredObjectMeta,
} from './storage.js';

// Instantiated via a factory in StorageModule, hence no @Injectable.
export class S3ObjectStorage extends ObjectStorage implements OnModuleInit {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {
    super();
  }

  // Same idea as ensureTopics in libs/events: the bucket has to exist before
  // the first put, so create it upfront.
  async onModuleInit() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!(error instanceof NotFound)) throw error;
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Buffer, { contentType, filename }: StoredObjectMeta) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // S3 metadata must be ASCII.
        Metadata: { filename: encodeURIComponent(filename) },
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    let res;
    try {
      res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      if (error instanceof NoSuchKey) {
        throw new ObjectNotFoundError(`Object ${key} does not exist`);
      }
      throw error;
    }
    if (!res.Body) throw new Error(`Object ${key} has no body`);

    return {
      body: Buffer.from(await res.Body.transformToByteArray()),
      contentType: res.ContentType ?? 'application/octet-stream',
      filename: decodeURIComponent(res.Metadata?.filename ?? key),
    };
  }
}
