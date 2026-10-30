// A topic name tagged with its payload type. The lib never looks at payloads;
// the tag only lets publish/on check them at compile time. Define topics next
// to the domain that owns them: `export const Foo = topic<FooPayload>('foo')`.
export interface Topic<T> {
  readonly name: string;
  /** Type-only marker, never set at runtime. */
  readonly _payload?: T;
}

export const topic = <T>(name: string): Topic<T> => ({ name });

export type EventHandler<T> = (payload: T) => Promise<void>;

// Abstract classes double as DI tokens, so mocks are just
// `{ provide: EventPublisher, useValue: { publish: vi.fn() } }`.
export abstract class EventPublisher {
  abstract publish<T>(topic: Topic<T>, payload: T): Promise<void>;
}

export abstract class EventConsumer {
  abstract on<T>(topic: Topic<T>, handler: EventHandler<T>): void;
}
