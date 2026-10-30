import { DynamicModule, Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { ObjectStorage } from './storage.js';
import { S3ObjectStorage } from './s3.js';

@Module({})
export class StorageModule {
  // Defaults match the seaweedfs service in docker-compose.yml.
  static register(): DynamicModule {
    return {
      module: StorageModule,
      providers: [
        {
          provide: ObjectStorage,
          useFactory: () =>
            new S3ObjectStorage(
              new S3Client({
                endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
                region: process.env.S3_REGION ?? 'us-east-1',
                forcePathStyle: true,
                credentials: {
                  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'local',
                  secretAccessKey:
                    process.env.S3_SECRET_ACCESS_KEY ?? 'local-secret',
                },
              }),
              process.env.S3_BUCKET ?? 'documents',
            ),
        },
      ],
      exports: [ObjectStorage],
    };
  }
}
