import { Injectable, Logger } from '@nestjs/common';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { DocumentContent } from './document-content.js';

// TODO: placeholder task until we decide what the LLM does with a document.
const PROMPT = 'Summarize this document.';

interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  error?: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  private readonly model = process.env.OLLAMA_MODEL ?? 'qwen3-vl:2b';
  // Ollama's default context is small and it silently drops whatever doesn't
  // fit, so set it explicitly.
  private readonly numCtx = Number(process.env.OLLAMA_NUM_CTX ?? 32768);

  async readDocument(document: DocumentContent): Promise<string> {
    const { title } = document;
    // Rough 4-chars-per-token estimate, just to make truncation visible.
    if ('text' in document && document.text.length / 4 > this.numCtx) {
      this.logger.warn(
        `${title} is ~${Math.round(document.text.length / 4)} tokens, over num_ctx ${this.numCtx}; Ollama will truncate it`,
      );
    }

    // Streamed: fetch gives up after 5 min without response headers, and a
    // non-streamed local generation can take longer than that.
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        options: { num_ctx: this.numCtx },
        messages: [toMessage(document)],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    }

    let answer = '';
    const lines = createInterface({
      input: Readable.fromWeb(res.body as ReadableStream),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as OllamaChatChunk;
      if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
      answer += chunk.message?.content ?? '';
      if (chunk.done && chunk.done_reason === 'length') {
        this.logger.warn(`Answer truncated at the length limit: ${title}`);
      }
    }
    return answer;
  }
}

function toMessage(document: DocumentContent) {
  if ('images' in document) {
    return {
      role: 'user',
      content: `The pages of "${document.title}" are attached as images, in order.\n\n${PROMPT}`,
      images: document.images,
    };
  }
  // Document first, question last.
  return {
    role: 'user',
    content: `<document title="${document.title}">\n${document.text}\n</document>\n\n${PROMPT}`,
  };
}
