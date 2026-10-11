import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import type { NewDraftVideo } from '../videos/videos.repository';
import { buildStorageKeys } from '../videos/upload-plan.util';

export async function createUserWithChannel(
  dataSource: DataSource,
): Promise<{ user: User; channel: Channel }> {
  const suffix = randomUUID().slice(0, 8);
  const user = await dataSource.getRepository(User).save({
    email: `video-owner-${suffix}@example.com`,
    password: 'hashed',
    is_confirmed: true,
  });
  const channel = await dataSource.getRepository(Channel).save({
    name: 'owner',
    nickname: `owner_${suffix}`,
    user_id: user.id,
  });
  return { user, channel };
}

export function buildDraftVideo(
  channelId: string,
  overrides: Partial<NewDraftVideo> = {},
): NewDraftVideo {
  const id = randomUUID();
  return {
    id,
    channel_id: channelId,
    title: 'Sample clip',
    original_filename: 'sample.mp4',
    content_type: 'video/mp4',
    size_bytes: 1024,
    storage_key: buildStorageKeys(id).source,
    upload_id: 'test-upload-id',
    upload_part_size: 64 * 1024 * 1024,
    upload_part_count: 1,
    upload_expires_at: new Date(Date.now() + 24 * 3600 * 1000),
    ...overrides,
  };
}
