import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DocumentProcess } from '@app/contracts';
import { EventConsumer } from '@app/events';
import { ObjectNotFoundError, ObjectStorage } from '@app/storage';
import {
  toDocumentContent,
  UnreadableDocumentError,
} from './document-content.js';
import { LlmService } from './llm.service.js';

@Injectable()
export class WorkerService implements OnModuleInit {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    private readonly consumer: EventConsumer,
    private readonly storage: ObjectStorage,
    private readonly llm: LlmService,
  ) {}

  onModuleInit() {
    this.consumer.on(DocumentProcess, (payload) =>
      this.processDocument(payload),
    );
  }

  async processDocument({ documentId, key }: DocumentProcess) {
    this.logger.log(`Processing document ${documentId}`);
    let document;
    try {
      document = await toDocumentContent(await this.storage.get(key));
    } catch (error) {
      // Retrying won't bring the file back or make it readable, so drop it
      // instead of letting the consumer redeliver it forever. A redelivered
      // message also blocks every message behind it on the partition.
      if (
        !(error instanceof ObjectNotFoundError) &&
        !(error instanceof UnreadableDocumentError)
      ) {
        throw error;
      }
      this.logger.warn(`Skipping document ${documentId}: ${error.message}`);
      return;
    }

    const answer = await this.llm.readDocument(document);
    this.logger.log(`Document ${documentId}: ${answer}`);
  }
}
