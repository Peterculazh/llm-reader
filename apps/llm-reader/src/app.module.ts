import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { StorageModule } from '@app/storage';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [
    EventsModule.register({ clientId: 'llm-reader' }),
    StorageModule.register(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
