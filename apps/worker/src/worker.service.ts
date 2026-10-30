import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DocumentProcess } from '@app/contracts';
import { DocumentsRepository } from '@app/db';
import { EventConsumer } from '@app/events';
import { ObjectNotFoundError, ObjectStorage } from '@app/storage';
import {
  toDocumentContent,
  UnreadableDocumentError,
} from './document-content.js';
import { LlmService } from './llm.service.js';

export const MAX_ATTEMPTS = 3;
// Waits before attempts 2 and 3. The wait holds up the consumer, so the total
// must stay well under max.poll.interval.ms (5 min), or Kafka assumes the
// worker died and hands the partition to another consumer.
export const RETRY_DELAYS_MS = [10_000, 30_000];

@Injectable()
export class WorkerService implements OnModuleInit {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    private readonly consumer: EventConsumer,
    private readonly storage: ObjectStorage,
    private readonly llm: LlmService,
    private readonly documents: DocumentsRepository,
  ) {}

  onModuleInit() {
    this.consumer.on(DocumentProcess, (payload) =>
      this.processDocument(payload),
    );
  }

  async processDocument({ runId }: DocumentProcess) {
    // Messages published before runs existed carry no runId.
    const found = runId ? await this.documents.findRun(runId) : undefined;
    if (!found) {
      this.logger.warn(`Skipping run ${runId}: not found`);
      return;
    }
    const { run, document } = found;
    // Kafka can redeliver a message that was already handled. A run left in
    // processing is picked up again: the previous attempt didn't finish.
    if (run.status === 'done' || run.status === 'failed') {
      this.logger.log(`Skipping run ${runId}: already ${run.status}`);
      return;
    }

    const attempt = await this.documents.markProcessing(runId);
    // Only reachable if an earlier attempt never got to its catch: the worker
    // died mid-run. Stop here so a file that crashes it can't loop forever.
    if (attempt > MAX_ATTEMPTS) {
      this.logger.warn(`Run ${runId} failed: out of attempts`);
      await this.documents.markFailed(
        runId,
        `Gave up after ${MAX_ATTEMPTS} attempts that did not finish`,
        true,
      );
      return;
    }

    this.logger.log(
      `Processing run ${runId} of document ${document.id}, attempt ${attempt}/${MAX_ATTEMPTS}`,
    );
    let answer;
    try {
      const content = await toDocumentContent(
        await this.storage.get(document.storageKey),
      );
      answer = await this.llm.readDocument(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Retrying won't bring the file back or make it readable, so fail the
      // run right away.
      if (
        error instanceof ObjectNotFoundError ||
        error instanceof UnreadableDocumentError
      ) {
        this.logger.warn(`Run ${runId} failed: ${message}`);
        await this.documents.markFailed(runId, message, false);
        return;
      }
      // Anything else (Ollama down, storage unreachable) may pass, so retry a
      // few times, then fail the run instead of letting the consumer
      // redeliver it forever. A redelivered message also blocks every message
      // behind it on the partition.
      if (attempt >= MAX_ATTEMPTS) {
        this.logger.warn(
          `Run ${runId} failed after ${attempt} attempts: ${message}`,
        );
        await this.documents.markFailed(runId, message, true);
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt - 1];
      this.logger.warn(
        `Run ${runId} attempt ${attempt} failed, retrying in ${delay / 1000}s: ${message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      throw error; // the consumer redelivers the message
    }

    await this.documents.markDone(runId, answer);
    this.logger.log(`Run ${runId} done`);
  }
}
