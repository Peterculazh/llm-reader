import {
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
// CJS package whose named exports Node's ESM loader can't detect.
import confluentKafka from '@confluentinc/kafka-javascript';
import {
  EventConsumer,
  EventHandler,
  EventPublisher,
  Topic,
} from './events.js';

export const { KafkaJS } = confluentKafka;

// Instantiated via factories in EventsModule, hence no @Injectable.
export class KafkaPublisher
  extends EventPublisher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly producer: confluentKafka.KafkaJS.Producer;

  constructor(kafka: confluentKafka.KafkaJS.Kafka) {
    super();
    this.producer = kafka.producer();
  }

  async onModuleInit() {
    await this.producer.connect();
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
  }

  async publish<T>(topic: Topic<T>, payload: T) {
    await this.producer.send({
      topic: topic.name,
      messages: [{ value: JSON.stringify(payload) }],
    });
  }
}

export class KafkaConsumer
  extends EventConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(KafkaConsumer.name);
  private readonly handlers = new Map<string, EventHandler<any>>();
  private readonly consumer: confluentKafka.KafkaJS.Consumer;

  constructor(kafka: confluentKafka.KafkaJS.Kafka, groupId: string) {
    super();
    this.consumer = kafka.consumer({
      kafkaJS: { groupId, fromBeginning: true },
    });
  }

  on<T>(topic: Topic<T>, handler: EventHandler<T>) {
    this.handlers.set(topic.name, handler);
  }

  // Runs after every onModuleInit, so all handlers are registered by now.
  async onApplicationBootstrap() {
    if (this.handlers.size === 0) return;

    const topics = [...this.handlers.keys()];
    await this.consumer.connect();
    await this.ensureTopics(topics);
    await this.consumer.subscribe({ topics });
    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const handler = this.handlers.get(topic);
        if (!handler || !message.value) return;
        try {
          await handler(JSON.parse(message.value.toString()));
        } catch (error) {
          this.logger.error(
            `Failed to handle ${topic}@${message.offset}`,
            error instanceof Error ? error.stack : error,
          );
          throw error; // let the client retry the message
        }
      },
    });
  }

  async onModuleDestroy() {
    if (this.handlers.size === 0) return;
    await this.consumer.disconnect();
  }

  // Subscribing to a topic that doesn't exist yet silently misses messages
  // until the next metadata refresh (5 min by default), so create it upfront.
  // Already-existing topics are ignored by createTopics.
  private async ensureTopics(topics: string[]) {
    const admin = this.consumer.dependentAdmin();
    await admin.connect();
    try {
      await admin.createTopics({ topics: topics.map((topic) => ({ topic })) });
    } finally {
      await admin.disconnect();
    }
  }
}
