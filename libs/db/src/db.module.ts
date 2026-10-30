import { DynamicModule, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DB, type Db } from './db.js';
import { DocumentsRepository } from './documents.repository.js';
import * as schema from './schema.js';

@Module({})
export class DbModule implements OnModuleDestroy {
  constructor(private readonly pool: Pool) {}

  // Default matches the postgres service in docker-compose.yml.
  static register(): DynamicModule {
    return {
      module: DbModule,
      providers: [
        {
          provide: Pool,
          useFactory: () =>
            new Pool({
              connectionString:
                process.env.DATABASE_URL ??
                'postgres://llm_reader:llm_reader@localhost:5432/llm_reader',
            }),
        },
        {
          provide: DB,
          useFactory: (pool: Pool): Db => drizzle({ client: pool, schema }),
          inject: [Pool],
        },
        DocumentsRepository,
      ],
      exports: [DB, DocumentsRepository],
    };
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
