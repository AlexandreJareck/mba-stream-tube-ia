import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { ChannelVideosController } from './channel-videos.controller';
import { Video } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import { VideoPlaybackService } from './video-playback.service';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideoQueueModule } from './video-queue.module';
import { PUBLIC_ID_GENERATOR, VideosRepository } from './videos.repository';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
    StorageModule,
    VideoQueueModule.register('producer'),
  ],
  controllers: [ChannelVideosController, VideosController],
  providers: [
    VideosService,
    VideosRepository,
    VideoProcessingQueue,
    VideoPlaybackService,
    { provide: PUBLIC_ID_GENERATOR, useValue: generatePublicId },
  ],
  exports: [VideosRepository],
})
export class VideosModule {}
