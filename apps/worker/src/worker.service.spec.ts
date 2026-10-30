import { Test, TestingModule } from '@nestjs/testing';
import { DocumentProcess } from '@app/contracts';
import { EventConsumer } from '@app/events';
import { ObjectNotFoundError, ObjectStorage } from '@app/storage';
import { LlmService } from './llm.service.js';
import { WorkerService } from './worker.service.js';

describe('WorkerService', () => {
  let workerService: WorkerService;
  const consumer = { on: vi.fn() };
  const storage = { get: vi.fn() };
  const llm = { readDocument: vi.fn() };

  const payload: DocumentProcess = {
    documentId: 'abc',
    key: 'documents/abc',
    contentType: 'text/plain',
    filename: 'a.txt',
    prompt: 'Summarize it',
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const app: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerService,
        { provide: EventConsumer, useValue: consumer },
        { provide: ObjectStorage, useValue: storage },
        { provide: LlmService, useValue: llm },
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

  it('loads the file from storage and sends it to the LLM', async () => {
    storage.get.mockResolvedValue({
      body: Buffer.from('hello'),
      contentType: 'text/plain',
      filename: 'a.txt',
    });

    await workerService.processDocument(payload);

    expect(storage.get).toHaveBeenCalledWith('documents/abc');
    expect(llm.readDocument).toHaveBeenCalledWith({
      title: 'a.txt',
      text: 'hello',
    });
  });

  it('skips unsupported files instead of failing the message', async () => {
    storage.get.mockResolvedValue({
      body: Buffer.from(''),
      contentType: 'image/png',
      filename: 'a.png',
    });

    await expect(
      workerService.processDocument(payload),
    ).resolves.toBeUndefined();
    expect(llm.readDocument).not.toHaveBeenCalled();
  });

  it('skips files missing from storage instead of failing the message', async () => {
    storage.get.mockRejectedValue(new ObjectNotFoundError('gone'));

    await expect(
      workerService.processDocument(payload),
    ).resolves.toBeUndefined();
    expect(llm.readDocument).not.toHaveBeenCalled();
  });

  it('rethrows other storage errors so the message is retried', async () => {
    storage.get.mockRejectedValue(new Error('connection refused'));

    await expect(workerService.processDocument(payload)).rejects.toThrow(
      'connection refused',
    );
  });
});
