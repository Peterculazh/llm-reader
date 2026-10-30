import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DocumentsRepository } from './index.js';

// Requires running and migrated Postgres:
// `docker compose up -d postgres && npm run db:migrate`.
describe('Postgres (e2e)', () => {
  let app: TestingModule;
  let documents: DocumentsRepository;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [DbModule.register()],
    }).compile();
    await app.init();
    documents = app.get(DocumentsRepository);
  });

  afterEach(async () => {
    await app?.close();
  });

  const create = () => {
    const id = randomUUID();
    return documents.create(
      {
        id,
        storageKey: `e2e/${id}`,
        filename: 'отчёт 2026.pdf',
        contentType: 'application/pdf',
        sizeBytes: 12,
      },
      'Summarize it',
    );
  };

  it('creates a document with a queued run', async () => {
    const runId = await create();

    const found = await documents.findRun(runId);

    expect(found?.run).toMatchObject({
      prompt: 'Summarize it',
      status: 'queued',
      answer: null,
    });
    expect(found?.document).toMatchObject({
      filename: 'отчёт 2026.pdf',
      sizeBytes: 12,
    });
  }, 30_000);

  it('moves a run through processing to done', async () => {
    const runId = await create();

    await documents.markProcessing(runId);
    expect((await documents.findRun(runId))?.run.status).toBe('processing');

    await documents.markDone(runId, 'an answer');
    const { run } = (await documents.findRun(runId))!;
    expect(run).toMatchObject({ status: 'done', answer: 'an answer' });
    expect(run.updatedAt.getTime()).toBeGreaterThan(run.createdAt.getTime());
  }, 30_000);

  it('counts attempts', async () => {
    const runId = await create();
    expect((await documents.findRun(runId))?.run.attempts).toBe(0);

    await expect(documents.markProcessing(runId)).resolves.toBe(1);
    await expect(documents.markProcessing(runId)).resolves.toBe(2);
  }, 30_000);

  it('records why a run failed and whether to retry it', async () => {
    const runId = await create();
    expect((await documents.findRun(runId))?.run.retryable).toBeNull();

    await documents.markFailed(runId, 'unreadable', false);

    expect((await documents.findRun(runId))?.run).toMatchObject({
      status: 'failed',
      error: 'unreadable',
      retryable: false,
    });
  }, 30_000);

  it('returns undefined for a missing run', async () => {
    await expect(documents.findRun(randomUUID())).resolves.toBeUndefined();
  }, 30_000);
});
