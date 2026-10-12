import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import databaseConfig from '../config/database.config';
import { envValidationSchema } from '../config/env.validation';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { buildTypeOrmOptions } from '../database/typeorm-options';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { MediaProbeService } from '../videos/processing/media-probe.service';
import {
  UploadSweepScheduler,
  UploadSweeperService,
} from '../videos/processing/upload-sweeper.service';
import { VideoProcessingProcessor } from '../videos/processing/video-processing.processor';
import { VideoProcessingService } from '../videos/processing/video-processing.service';
import {
  ProcessingReconcileScheduler,
  ProcessingReconcilerService,
} from '../videos/processing/processing-reconciler.service';
import { generatePublicId } from '../videos/public-id.util';
import { VideoQueueModule } from '../videos/video-queue.module';
import { VideoProcessingQueue } from '../videos/video-processing.queue';
import {
  PUBLIC_ID_GENERATOR,
  VideosRepository,
} from '../videos/videos.repository';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

/**
 * Root module of the standalone video worker (`src/worker.ts`) —
 * phase-03-videos/TD-04. No HTTP layer; it is the only place the
 * `video-processing` processor is registered.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, storageConfig, queueConfig, videoConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) =>
        buildTypeOrmOptions(dbConfig),
    }),
    // Video's relation graph (Video → Channel → User) must be registered.
    TypeOrmModule.forFeature([Video, Channel, User]),
    StorageModule,
    VideoQueueModule.register('consumer'),
  ],
  providers: [
    VideosRepository,
    { provide: PUBLIC_ID_GENERATOR, useValue: generatePublicId },
    MediaProbeService,
    VideoProcessingService,
    VideoProcessingQueue,
    VideoProcessingProcessor,
    ProcessingReconcilerService,
    ProcessingReconcileScheduler,
    UploadSweeperService,
    UploadSweepScheduler,
    WorkerHeartbeatService,
  ],
})
export class WorkerModule {}
