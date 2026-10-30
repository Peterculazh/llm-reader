import { DynamicModule, Module, Provider } from '@nestjs/common';
import { EventConsumer, EventPublisher } from './events.js';
import { KafkaConsumer, KafkaJS, KafkaPublisher } from './kafka.js';

type Kafka = InstanceType<typeof KafkaJS.Kafka>;

export interface EventsModuleOptions {
  clientId: string;
  /** Set to enable EventConsumer for this app. */
  groupId?: string;
}

@Module({})
export class EventsModule {
  static register({ clientId, groupId }: EventsModuleOptions): DynamicModule {
    const providers: Provider[] = [
      {
        provide: KafkaJS.Kafka,
        useFactory: () =>
          new KafkaJS.Kafka({
            kafkaJS: {
              clientId,
              brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(
                ',',
              ),
            },
          }),
      },
      {
        provide: EventPublisher,
        useFactory: (kafka: Kafka) => new KafkaPublisher(kafka),
        inject: [KafkaJS.Kafka],
      },
    ];
    const exports: NonNullable<DynamicModule['exports']> = [EventPublisher];

    if (groupId) {
      providers.push({
        provide: EventConsumer,
        useFactory: (kafka: Kafka) => new KafkaConsumer(kafka, groupId),
        inject: [KafkaJS.Kafka],
      });
      exports.push(EventConsumer);
    }

    return { module: EventsModule, providers, exports };
  }
}
