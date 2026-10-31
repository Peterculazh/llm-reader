# LLM Reader

Upload a document with a prompt and get the answer from a local LLM later.

The API stores the file in S3-compatible storage, records a run in Postgres and publishes a Kafka event. A separate worker picks the event up, extracts the document's content and sends it to [Ollama](https://ollama.com). You then fetch the result by run ID.

```text
client ──POST /──▶ API ──▶ S3 (file)
                    │  ──▶ Postgres (document + run, status: queued)
                    └────▶ Kafka: document.process { runId }
                                     │
                                     ▼
                                  worker ──▶ S3 (read file)
                                     │   ──▶ Ollama (/api/chat)
                                     └────▶ Postgres (status: done | failed)

client ──GET /:runId──▶ API ──▶ Postgres
```

## Supported documents

Uploads are capped at 20 MB.

| Type | Content type                                                              | How it's read                                                                     |
| ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| PDF  | `application/pdf`                                                         | Text layer. If there is none, the first 10 pages are sent to the model as images. |
| Word | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | Plain text extracted with mammoth.                                                |
| Text | `text/plain`, `text/markdown`                                             | As is.                                                                            |

Scanned PDFs need a vision model. The default, `qwen3-vl:2b`, is one.

## Repository layout

This is a Nest monorepo with two apps and shared libraries.

| Path              | What it is                                                  |
| ----------------- | ----------------------------------------------------------- |
| `apps/llm-reader` | HTTP API: accepts uploads and returns results.              |
| `apps/worker`     | Kafka consumer: extracts document content and calls Ollama. |
| `libs/contracts`  | Kafka topics and their payloads, shared by both apps.       |
| `libs/events`     | Publisher/consumer abstraction over Kafka.                  |
| `libs/storage`    | Object storage abstraction over S3, plus upload limits.     |
| `libs/db`         | Drizzle schema, migrations and `DocumentsRepository`.       |
| `docker/`         | Config mounted into the compose services.                   |

## Prerequisites

- Node.js (the project is typed against Node 24)
- Docker with Compose
- [Ollama](https://ollama.com) running on the host, with the model pulled:

  ```bash
  ollama pull qwen3-vl:2b
  ```

## Getting started

```bash
npm install

# Kafka, Kafka UI, SeaweedFS (S3) and Postgres
docker compose up -d

# Create the tables
npm run db:migrate

# In separate terminals
npm run start:dev      # API on http://localhost:3000
npm run start:worker   # worker
```

The Kafka topic and the S3 bucket are created on startup if they don't exist.

## API

Swagger UI is served at <http://localhost:3000/api>.

### `POST /` — queue a document

Multipart form with `file` and `prompt`. The prompt is sent to the model after the document's content. Returns `202` with the IDs of the stored document and of the run:

```bash
curl -F "file=@report.pdf" -F "prompt=Summarize this document." http://localhost:3000/
```

```json
{ "documentId": "…", "runId": "…" }
```

Returns `400` if `prompt` is missing or empty, `415` if the file is missing or of an unsupported type, and `413` if it's over 20 MB.

### `GET /all` — list documents

Every run with its document, newest first. There is no auth yet, so this returns everyone's uploads. Answers are left out; fetch them with `GET /:runId`.

```bash
curl http://localhost:3000/all
```

```json
[
  {
    "runId": "…",
    "documentId": "…",
    "filename": "report.pdf",
    "contentType": "application/pdf",
    "sizeBytes": 48213,
    "prompt": "Summarize this document.",
    "status": "done",
    "error": null,
    "createdAt": "2026-10-30T14:05:31.000Z",
    "updatedAt": "2026-10-30T14:05:52.000Z"
  }
]
```

### `GET /:runId` — get the result

```bash
curl http://localhost:3000/<runId>
```

```json
{
  "result": "…",
  "prompt": "Summarize this document.",
  "filename": "report.pdf"
}
```

| Status | Meaning                                  |
| ------ | ---------------------------------------- |
| `200`  | The run is done.                         |
| `400`  | `runId` is not a UUID.                   |
| `404`  | No such run.                             |
| `409`  | The run is queued, processing or failed. |

## Processing and retries

A run goes `queued` → `processing` → `done` or `failed`.

- **Missing or unreadable file** (unsupported type, corrupt PDF, no text): the run fails right away with `retryable = false`.
- **Other errors** (Ollama or storage unreachable): the worker retries up to 3 attempts in total, waiting 10 s and then 30 s. After the last one the run fails with `retryable = true`.
- **Redelivered messages** for runs that are already `done` or `failed` are skipped. A run left in `processing` by a crashed worker is picked up again and counts as an attempt.

The error message and attempt count are stored on the run in `document_runs`.

## Configuration

Everything has a default that matches `docker-compose.yml`, so no config is needed for local development. Variables are read from the process environment; `.env` files are not loaded.

| Variable               | Used by                  | Default                                                      |
| ---------------------- | ------------------------ | ------------------------------------------------------------ |
| `PORT`                 | API                      | `3000`                                                       |
| `DATABASE_URL`         | API, worker, drizzle-kit | `postgres://llm_reader:llm_reader@localhost:5432/llm_reader` |
| `KAFKA_BROKERS`        | API, worker              | `localhost:9092` (comma-separated)                           |
| `S3_ENDPOINT`          | API, worker              | `http://localhost:8333`                                      |
| `S3_REGION`            | API, worker              | `us-east-1`                                                  |
| `S3_ACCESS_KEY_ID`     | API, worker              | `local`                                                      |
| `S3_SECRET_ACCESS_KEY` | API, worker              | `local-secret`                                               |
| `S3_BUCKET`            | API, worker              | `documents`                                                  |
| `OLLAMA_URL`           | worker                   | `http://localhost:11434`                                     |
| `OLLAMA_MODEL`         | worker                   | `qwen3-vl:2b`                                                |
| `OLLAMA_NUM_CTX`       | worker                   | `32768`                                                      |

### Docker Compose ports

Host ports can be overridden with these variables. If you change one, point the matching app variable above at it too (e.g. `POSTGRES_PORT=5433` needs `DATABASE_URL=…@localhost:5433/…`).

| Service         | Variable        | Default | Notes                                                     |
| --------------- | --------------- | ------- | --------------------------------------------------------- |
| Kafka           | `KAFKA_PORT`    | `9092`  |                                                           |
| Kafka UI        | `KAFKA_UI_PORT` | `8080`  | Browse topics and messages.                               |
| SeaweedFS S3    | `S3_PORT`       | `8333`  |                                                           |
| SeaweedFS filer | `FILER_UI_PORT` | `8888`  | Browse stored files under `/buckets/`.                    |
| Postgres        | `POSTGRES_PORT` | `5432`  | Also `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`. |

## Database

The schema lives in `libs/db/src/schema.ts` and migrations in `libs/db/migrations`.

```bash
npm run db:generate   # create a migration after changing the schema
npm run db:migrate    # apply migrations
npm run db:studio     # browse the data in Drizzle Studio
```

## Tests

```bash
npm test              # unit tests
npm run test:cov      # unit tests with coverage
npm run test:e2e      # e2e tests
```

E2E tests talk to the real services, so start them and apply migrations first:

```bash
docker compose up -d
npm run db:migrate
```
