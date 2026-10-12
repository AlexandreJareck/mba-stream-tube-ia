import { Test } from '@nestjs/testing';
import { VideoProcessingProcessor } from '../videos/processing/video-processing.processor';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should compile with the processor and the heartbeat', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    try {
      await module.init();
      expect(module.get(VideoProcessingProcessor)).toBeInstanceOf(
        VideoProcessingProcessor,
      );
      await expect(module.get(WorkerHeartbeatService).beat()).resolves.toBe(
        true,
      );
    } finally {
      await module.close();
    }
  });
});
