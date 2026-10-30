// Not the index: contracts shouldn't pull in the Kafka client.
import { topic } from '@app/events/events.js';

// Only a reference to the run in Postgres, which points at the file in object
// storage: Kafka messages are capped at ~1 MB by default, so the bytes never
// go through here, and the worker reads everything else from the run.
export interface DocumentProcess {
  runId: string;
}

export const DocumentProcess = topic<DocumentProcess>('document.process');
