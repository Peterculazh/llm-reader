// Not the index: contracts shouldn't pull in the Kafka client.
import { topic } from '@app/events/events.js';

// Only a reference to the file in object storage: Kafka messages are capped
// at ~1 MB by default, so the bytes never go through here.
export interface DocumentProcess {
  documentId: string;
  key: string;
  contentType: string;
  filename: string;
  prompt: string;
}

export const DocumentProcess = topic<DocumentProcess>('document.process');
