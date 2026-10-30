import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { StorageModule } from '@app/storage';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    EventsModule.register({ clientId: 'llm-reader' }),
    StorageModule.register(),
    DbModule.register(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
