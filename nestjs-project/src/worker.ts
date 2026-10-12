import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

/** Standalone video worker: no HTTP server, consumes `video-processing` jobs. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // SIGTERM/SIGINT → Nest shutdown hooks → BullMQ worker.close() drains active jobs.
  app.enableShutdownHooks();
  Logger.log('Video worker started', 'Worker');
}

void bootstrap();
