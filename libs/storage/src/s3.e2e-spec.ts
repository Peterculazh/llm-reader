import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ObjectNotFoundError, ObjectStorage, StorageModule } from './index.js';

// Requires running storage: `docker compose up -d seaweedfs`.
describe('S3 storage (e2e)', () => {
  let app: TestingModule;

  afterEach(async () => {
    await app?.close();
  });

  it('round-trips an object with its metadata', async () => {
    app = await Test.createTestingModule({
      imports: [StorageModule.register()],
    }).compile();
    await app.init();
    const storage = app.get(ObjectStorage);

    const key = `e2e/${randomUUID()}`;
    const body = Buffer.from('%PDF-1.7 e2e');
    await storage.put(key, body, {
      contentType: 'application/pdf',
      filename: 'отчёт 2026.pdf',
    });

    await expect(storage.get(key)).resolves.toEqual({
      body,
      contentType: 'application/pdf',
      filename: 'отчёт 2026.pdf',
    });
  }, 30_000);

  it('throws ObjectNotFoundError for a missing key', async () => {
    app = await Test.createTestingModule({
      imports: [StorageModule.register()],
    }).compile();
    await app.init();

    await expect(
      app.get(ObjectStorage).get(`e2e/${randomUUID()}`),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
  }, 30_000);
});
