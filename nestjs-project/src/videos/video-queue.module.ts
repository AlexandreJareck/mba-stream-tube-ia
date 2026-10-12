import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';
import { VIDEO_QUEUE } from './videos.constants';

export type QueueRole = 'producer' | 'consumer';

/**
 * Redis connection + `video-processing` queue registration shared by the API
 * (producer) and the worker (consumer). Processors are registered only by the
 * worker module, so the API process never consumes jobs.
 */
@Module({})
export class VideoQueueModule {
  static register(role: QueueRole): DynamicModule {
    return {
      module: VideoQueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [queueConfig.KEY],
          useFactory: (config: ConfigType<typeof queueConfig>) => ({
            connection: {
              host: config.host,
              port: config.port,
              // The API must fail fast (503 QUEUE_UNAVAILABLE) instead of
              // buffering commands while Redis is down; the worker keeps
              // BullMQ's default reconnect behaviour.
              ...(role === 'producer' && { enableOfflineQueue: false }),
            },
          }),
        }),
        BullModule.registerQueue({ name: VIDEO_QUEUE.NAME }),
      ],
      exports: [BullModule],
    };
  }
}
