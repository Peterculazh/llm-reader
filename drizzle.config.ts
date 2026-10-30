import { defineConfig } from 'drizzle-kit';

// Default matches the postgres service in docker-compose.yml.
export default defineConfig({
  dialect: 'postgresql',
  schema: './libs/db/src/schema.ts',
  out: './libs/db/migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://llm_reader:llm_reader@localhost:5432/llm_reader',
  },
});
