import type { Job, Queue } from 'bullmq';
import type { VideoProcessMessage } from '../videos/video-process.message';

const ALL_STATES = [
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'completed',
  'failed',
] as const;

/** Every `video.process` job (any state) published for a video. */
export async function jobsForVideo(
  queue: Queue,
  videoId: string,
): Promise<Job<VideoProcessMessage>[]> {
  const jobs = (await queue.getJobs([
    ...ALL_STATES,
  ])) as Job<VideoProcessMessage>[];
  return jobs.filter((job) => job?.data?.videoId === videoId);
}
