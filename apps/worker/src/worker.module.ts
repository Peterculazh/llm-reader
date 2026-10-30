import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { StorageModule } from '@app/storage';
import { LlmService } from './llm.service.js';
import { WorkerService } from './worker.service.js';

@Module({
  imports: [
    EventsModule.register({ clientId: 'worker', groupId: 'worker' }),
    StorageModule.register(),
    DbModule.register(),
  ],
  providers: [LlmService, WorkerService],
})
export class WorkerModule {}
