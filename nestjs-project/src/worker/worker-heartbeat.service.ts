import { writeFile } from 'node:fs/promises';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { VIDEO_QUEUE } from '../videos/videos.constants';

export const WORKER_HEARTBEAT_FILE = '/tmp/worker-heartbeat';
const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Liveness signal for the Compose health check: the file is refreshed only
 * while PostgreSQL and Redis both answer, so a stale file means unhealthy.
 */
@Injectable()
export class WorkerHeartbeatService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(VIDEO_QUEUE.NAME) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async beat(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      // Round trip to Redis through BullMQ (bullmq 6 hides the raw client).
      await this.queue.getJobCounts('waiting');
      await writeFile(WORKER_HEARTBEAT_FILE, new Date().toISOString());
      return true;
    } catch (error) {
      // Background task: log and let the health check go stale.
      this.logger.warn(`Heartbeat failed: ${(error as Error).message}`);
      return false;
    }
  }
}
