import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
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
  providers: [
    AppService,
    // Registered here rather than in main.ts so tests that boot AppModule
    // validate DTOs too.
    { provide: APP_PIPE, useValue: new ValidationPipe() },
  ],
})
export class AppModule {}
