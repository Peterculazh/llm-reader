import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DocumentsRepository } from '@app/db';
import { EventPublisher } from '@app/events';
import { ObjectStorage } from '@app/storage';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;
  const documents = { findRun: vi.fn(), listRuns: vi.fn() };

  const found = (status: string, answer: string | null = null) => ({
    run: { id: 'run-1', prompt: 'Summarize it', status, answer },
    document: { id: 'abc', filename: 'a.txt' },
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: EventPublisher, useValue: { publish: vi.fn() } },
        { provide: ObjectStorage, useValue: { put: vi.fn() } },
        { provide: DocumentsRepository, useValue: documents },
      ],
    }).compile();

    appController = app.get(AppController);
  });

  describe('listDocuments', () => {
    it('returns every run', async () => {
      const runs = [{ runId: 'run-1', filename: 'a.txt', status: 'done' }];
      documents.listRuns.mockResolvedValue(runs);

      await expect(appController.listDocuments()).resolves.toEqual(runs);
    });
  });

  describe('getDocumentResult', () => {
    it('returns the answer of a done run', async () => {
      documents.findRun.mockResolvedValue(found('done', 'a greeting'));

      await expect(appController.getDocumentResult('run-1')).resolves.toEqual({
        result: 'a greeting',
        prompt: 'Summarize it',
        filename: 'a.txt',
      });
    });

    it('responds 404 for a missing run', async () => {
      documents.findRun.mockResolvedValue(undefined);

      await expect(
        appController.getDocumentResult('run-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['queued', 'processing', 'failed'])(
      'responds 409 for a %s run',
      async (status) => {
        documents.findRun.mockResolvedValue(found(status));

        await expect(appController.getDocumentResult('run-1')).rejects.toThrow(
          new ConflictException(`Run run-1 is ${status}`),
        );
      },
    );

    it('lets other errors through as 500', async () => {
      documents.findRun.mockRejectedValue(new Error('connection refused'));

      await expect(appController.getDocumentResult('run-1')).rejects.toThrow(
        'connection refused',
      );
    });
  });
});
