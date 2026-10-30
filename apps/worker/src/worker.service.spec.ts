import { Test, TestingModule } from '@nestjs/testing';
import { DocumentProcess } from '@app/contracts';
import { DocumentsRepository } from '@app/db';
import { EventConsumer } from '@app/events';
import { ObjectNotFoundError, ObjectStorage } from '@app/storage';
import { LlmService } from './llm.service.js';
import {
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  WorkerService,
} from './worker.service.js';

describe('WorkerService', () => {
  let workerService: WorkerService;
  const consumer = { on: vi.fn() };
  const storage = { get: vi.fn() };
  const llm = { readDocument: vi.fn() };
  const documents = {
    findRun: vi.fn(),
    markProcessing: vi.fn(),
    markDone: vi.fn(),
    markFailed: vi.fn(),
  };

  const payload: DocumentProcess = { runId: 'run-1' };
  const found = (status = 'queued') => ({
    run: { id: 'run-1', documentId: 'abc', prompt: 'Summarize it', status },
    document: {
      id: 'abc',
      storageKey: 'documents/abc',
      contentType: 'text/plain',
      filename: 'a.txt',
    },
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    documents.findRun.mockResolvedValue(found());
    documents.markProcessing.mockResolvedValue(1);
    const app: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerService,
        { provide: EventConsumer, useValue: consumer },
        { provide: ObjectStorage, useValue: storage },
        { provide: LlmService, useValue: llm },
        { provide: DocumentsRepository, useValue: documents },
      ],
    }).compile();
    await app.init();

    workerService = app.get(WorkerService);
  });

  it('subscribes processDocument to document.process', async () => {
    const processDocument = vi
      .spyOn(workerService, 'processDocument')
      .mockResolvedValue();
    expect(consumer.on).toHaveBeenCalledWith(
      DocumentProcess,
      expect.any(Function),
    );

    const [, handler] = consumer.on.mock.calls[0];
    await handler(payload);

    expect(processDocument).toHaveBeenCalledWith(payload);
  });

  it('loads the file from storage, sends it to the LLM and saves the answer', async () => {
    storage.get.mockResolvedValue({
      body: Buffer.from('hello'),
      contentType: 'text/plain',
      filename: 'a.txt',
    });
    llm.readDocument.mockResolvedValue('a greeting');

    await workerService.processDocument(payload);

    expect(documents.findRun).toHaveBeenCalledWith('run-1');
    expect(documents.markProcessing).toHaveBeenCalledWith('run-1');
    expect(storage.get).toHaveBeenCalledWith('documents/abc');
    expect(llm.readDocument).toHaveBeenCalledWith({
      title: 'a.txt',
      text: 'hello',
    });
    expect(documents.markDone).toHaveBeenCalledWith('run-1', 'a greeting');
  });

  it('retries a run left in processing by an earlier attempt', async () => {
    documents.findRun.mockResolvedValue(found('processing'));
    storage.get.mockResolvedValue({
      body: Buffer.from('hello'),
      contentType: 'text/plain',
      filename: 'a.txt',
    });
    llm.readDocument.mockResolvedValue('a greeting');

    await workerService.processDocument(payload);

    expect(documents.markDone).toHaveBeenCalledWith('run-1', 'a greeting');
  });

  it.each(['done', 'failed'])(
    'skips a redelivered run that is already %s',
    async (status) => {
      documents.findRun.mockResolvedValue(found(status));

      await workerService.processDocument(payload);

      expect(storage.get).not.toHaveBeenCalled();
      expect(documents.markProcessing).not.toHaveBeenCalled();
    },
  );

  it('skips a run that does not exist', async () => {
    documents.findRun.mockResolvedValue(undefined);

    await expect(
      workerService.processDocument(payload),
    ).resolves.toBeUndefined();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('skips messages without a runId', async () => {
    await expect(
      workerService.processDocument({} as DocumentProcess),
    ).resolves.toBeUndefined();
    expect(documents.findRun).not.toHaveBeenCalled();
  });

  it('fails the run for unsupported files instead of failing the message', async () => {
    storage.get.mockResolvedValue({
      body: Buffer.from(''),
      contentType: 'image/png',
      filename: 'a.png',
    });

    await expect(
      workerService.processDocument(payload),
    ).resolves.toBeUndefined();
    expect(llm.readDocument).not.toHaveBeenCalled();
    expect(documents.markFailed).toHaveBeenCalledWith(
      'run-1',
      expect.any(String),
      false,
    );
  });

  it('fails the run for files missing from storage instead of failing the message', async () => {
    storage.get.mockRejectedValue(new ObjectNotFoundError('gone'));

    await expect(
      workerService.processDocument(payload),
    ).resolves.toBeUndefined();
    expect(llm.readDocument).not.toHaveBeenCalled();
    expect(documents.markFailed).toHaveBeenCalledWith('run-1', 'gone', false);
  });

  describe('on temporary errors', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      [1, RETRY_DELAYS_MS[0]],
      [2, RETRY_DELAYS_MS[1]],
    ])(
      'waits after attempt %i, then rethrows so the message is retried',
      async (attempt, delay) => {
        documents.markProcessing.mockResolvedValue(attempt);
        storage.get.mockRejectedValue(new Error('connection refused'));

        let settled = false;
        const processing = workerService
          .processDocument(payload)
          .finally(() => (settled = true));
        const rejected =
          expect(processing).rejects.toThrow('connection refused');

        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(documents.markFailed).not.toHaveBeenCalled();
      },
    );

    it('retries LLM errors too', async () => {
      storage.get.mockResolvedValue({
        body: Buffer.from('hello'),
        contentType: 'text/plain',
        filename: 'a.txt',
      });
      llm.readDocument.mockRejectedValue(new TypeError('fetch failed'));

      const rejected = expect(
        workerService.processDocument(payload),
      ).rejects.toThrow('fetch failed');
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
      await rejected;
      expect(documents.markDone).not.toHaveBeenCalled();
    });

    it('fails the run as retryable when the last attempt fails', async () => {
      documents.markProcessing.mockResolvedValue(MAX_ATTEMPTS);
      storage.get.mockRejectedValue(new Error('connection refused'));

      await expect(
        workerService.processDocument(payload),
      ).resolves.toBeUndefined();
      expect(documents.markFailed).toHaveBeenCalledWith(
        'run-1',
        'connection refused',
        true,
      );
    });
  });

  it('fails a run whose earlier attempts never finished', async () => {
    documents.findRun.mockResolvedValue(found('processing'));
    documents.markProcessing.mockResolvedValue(MAX_ATTEMPTS + 1);

    await workerService.processDocument(payload);

    expect(storage.get).not.toHaveBeenCalled();
    expect(documents.markFailed).toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining('did not finish'),
      true,
    );
  });
});
