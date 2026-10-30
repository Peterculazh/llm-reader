import { Injectable } from '@nestjs/common';
import { DocumentProcess } from '@app/contracts';
import { EventPublisher } from '@app/events';
import { randomUUID } from 'node:crypto';
import { ObjectStorage } from '@app/storage';

@Injectable()
export class AppService {
  constructor(
    private readonly events: EventPublisher,
    private readonly storage: ObjectStorage,
  ) {}

  async processDocument({
    file,
    prompt,
  }: {
    file: Express.Multer.File;
    prompt: string;
  }): Promise<string> {
    const documentId = randomUUID();
    const key = `documents/${documentId}`;
    const meta = { contentType: file.mimetype, filename: file.originalname };

    await this.storage.put(key, file.buffer, meta);
    await this.events.publish(DocumentProcess, {
      documentId,
      key,
      prompt,
      ...meta,
    });
    return documentId;
  }
}
