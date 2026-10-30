import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB, type Db } from './db.js';
import { documentRuns, documents, NewDocument } from './schema.js';

// Queries live here rather than in the apps, so services can be unit-tested
// with `{ provide: DocumentsRepository, useValue: { ... } }`.
@Injectable()
export class DocumentsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Inserts the document with its first run and returns the run id. */
  async create(document: NewDocument, prompt: string): Promise<string> {
    return this.db.transaction(async (tx) => {
      await tx.insert(documents).values(document);
      const [run] = await tx
        .insert(documentRuns)
        .values({ documentId: document.id, prompt })
        .returning({ id: documentRuns.id });
      return run.id;
    });
  }

  async findRun(runId: string) {
    const [row] = await this.db
      .select({ run: documentRuns, document: documents })
      .from(documentRuns)
      .innerJoin(documents, eq(documentRuns.documentId, documents.id))
      .where(eq(documentRuns.id, runId));
    return row;
  }

  /** Counts the attempt and returns its number, starting at 1. */
  async markProcessing(runId: string): Promise<number> {
    const [run] = await this.db
      .update(documentRuns)
      .set({
        status: 'processing',
        attempts: sql`${documentRuns.attempts} + 1`,
      })
      .where(eq(documentRuns.id, runId))
      .returning({ attempts: documentRuns.attempts });
    return run.attempts;
  }

  async markDone(runId: string, answer: string) {
    await this.db
      .update(documentRuns)
      .set({ status: 'done', answer, error: null })
      .where(eq(documentRuns.id, runId));
  }

  async markFailed(runId: string, error: string, retryable: boolean) {
    await this.db
      .update(documentRuns)
      .set({ status: 'failed', error, retryable })
      .where(eq(documentRuns.id, runId));
  }
}
