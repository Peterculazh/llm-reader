import { Injectable } from '@nestjs/common';
import { DocumentProcess } from '@app/contracts';
import { DocumentsRepository } from '@app/db';
import { EventPublisher } from '@app/events';
import { randomUUID } from 'node:crypto';
import { ObjectStorage } from '@app/storage';

// HTTP-neutral, like ObjectNotFoundError; the controller maps them to statuses.
export class RunNotFoundError extends Error {}

/** The run is queued, processing or failed, so it has no answer to return. */
export class RunNotDoneError extends Error {}

@Injectable()
export class AppService {
  constructor(
    private readonly events: EventPublisher,
    private readonly storage: ObjectStorage,
    private readonly documents: DocumentsRepository,
  ) {}

  async processDocument({
    file,
    prompt,
  }: {
    file: Express.Multer.File;
    prompt: string;
  }): Promise<{ documentId: string; runId: string }> {
    const documentId = randomUUID();
    const key = `documents/${documentId}`;
    const meta = { contentType: file.mimetype, filename: file.originalname };

    // File first, so a stored row always points at an existing object.
    await this.storage.put(key, file.buffer, meta);
    const runId = await this.documents.create(
      { id: documentId, storageKey: key, sizeBytes: file.size, ...meta },
      prompt,
    );
    // If this fails the run stays queued; acceptable until we need an outbox.
    await this.events.publish(DocumentProcess, { runId });
    return { documentId, runId };
  }

  // No auth yet, so every caller sees every run.
  listDocuments() {
    return this.documents.listRuns();
  }

  async getDocumentResult(
    runId: string,
  ): Promise<{ result: string | null; prompt: string; filename: string }> {
    const result = await this.documents.findRun(runId);
    if (!result) {
      throw new RunNotFoundError(`Run ${runId} not found`);
    }
    if (result.run.status !== 'done') {
      throw new RunNotDoneError(`Run ${runId} is ${result.run.status}`);
    }
    return {
      result: result.run.answer,
      prompt: result.run.prompt,
      filename: result.document.filename,
    };
  }
}
