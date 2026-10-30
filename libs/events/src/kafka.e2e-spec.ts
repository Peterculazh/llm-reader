import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { EventConsumer, EventPublisher, EventsModule, topic } from './index.js';

// A topic of its own, so this lib's test doesn't depend on any domain contract.
const Ping = topic<{ id: string }>('events.e2e.ping');

// Requires a running broker: `docker compose up -d kafka`.
describe('Kafka events (e2e)', () => {
  let app: TestingModule;

  afterEach(async () => {
    await app?.close();
  });

  it('delivers a published event to the consumer', async () => {
    app = await Test.createTestingModule({
      imports: [
        EventsModule.register({
          clientId: 'e2e',
          groupId: `e2e-${randomUUID()}`,
        }),
      ],
    }).compile();

    const id = randomUUID();
    // fromBeginning means earlier runs' messages arrive too, so match by id.
    const received = new Promise<void>((resolve) =>
      app.get(EventConsumer).on(Ping, async (p) => {
        if (p.id === id) resolve();
      }),
    );
    await app.init();

    await app.get(EventPublisher).publish(Ping, { id });

    await received;
  }, 60_000);
});
