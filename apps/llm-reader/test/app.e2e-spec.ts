import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

const textFile = {
  filename: 'a.txt',
  contentType: 'text/plain',
};

// Requires the whole stack, migrated: `docker compose up -d && npm run db:migrate`.
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('queues an uploaded document and reports the run as not done', async () => {
    const res = await request(app.getHttpServer())
      .post('/')
      .field('prompt', 'Summarize it')
      .attach('file', Buffer.from('hello'), textFile)
      .expect(202);

    expect(res.body).toEqual({
      documentId: expect.any(String),
      runId: expect.any(String),
    });
    // Checked right away, before a running worker could finish it.
    await request(app.getHttpServer()).get(`/${res.body.runId}`).expect(409);
  });

  it('rejects an upload without a prompt', () => {
    return request(app.getHttpServer())
      .post('/')
      .attach('file', Buffer.from('hello'), textFile)
      .expect(400);
  });

  it('rejects an unsupported file type', () => {
    return request(app.getHttpServer())
      .post('/')
      .field('prompt', 'Summarize it')
      .attach('file', Buffer.from('png'), {
        filename: 'a.png',
        contentType: 'image/png',
      })
      .expect(415);
  });

  it('responds 404 for an unknown run', () => {
    return request(app.getHttpServer()).get(`/${randomUUID()}`).expect(404);
  });

  it('responds 400 for a run id that is not a UUID', () => {
    return request(app.getHttpServer()).get('/not-a-uuid').expect(400);
  });
});
