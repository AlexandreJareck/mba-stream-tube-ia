import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus } from '../video-status.enum';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const TEN_GIB = 10737418240;

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channel: Channel;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: `owner-${randomUUID()}@example.com`,
      password: 'hashed',
    });
    channel = await dataSource.getRepository(Channel).save({
      name: 'owner',
      nickname: `owner_${randomUUID().slice(0, 8)}`,
      user_id: user.id,
    });
  });

  function buildVideo(overrides: Partial<Video> = {}): Partial<Video> {
    const id = randomUUID();
    return {
      id,
      channel_id: channel.id,
      public_id: randomUUID().replace(/-/g, '').slice(0, 11),
      title: 'My clip',
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: 1024,
      storage_key: `videos/${id}/source`,
      upload_part_size: 67108864,
      upload_part_count: 1,
      ...overrides,
    };
  }

  it('should default to draft with empty processing fields', async () => {
    const saved = await videoRepository.save(buildVideo());
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.status).toBe(VideoStatus.DRAFT);
    expect(found.processing_run).toBe(0);
    expect(found.thumbnail_key).toBeNull();
    expect(found.duration_seconds).toBeNull();
    expect(found.metadata).toBeNull();
  });

  it('should map size_bytes (bigint) to a number, including 10 GiB', async () => {
    const saved = await videoRepository.save(
      buildVideo({ size_bytes: TEN_GIB }),
    );
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.size_bytes).toBe(TEN_GIB);
    expect(typeof found.size_bytes).toBe('number');
  });

  it('should reject sizes above 10 GiB through the check constraint', async () => {
    await expect(
      videoRepository.save(buildVideo({ size_bytes: TEN_GIB + 1 })),
    ).rejects.toThrow(QueryFailedError);
  });

  it('should reject a duplicated public_id', async () => {
    await videoRepository.save(buildVideo({ public_id: 'dupPublicId' }));

    await expect(
      videoRepository.save(buildVideo({ public_id: 'dupPublicId' })),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });

  it('should reject a video pointing to a missing channel', async () => {
    await expect(
      videoRepository.save(buildVideo({ channel_id: randomUUID() })),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });

  it('should persist structured metadata as jsonb', async () => {
    const metadata = {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      bit_rate: 120000,
      width: 320,
      height: 240,
      video_codec: 'h264',
      audio_codec: 'aac',
      frame_rate: 10,
    };
    const saved = await videoRepository.save(buildVideo({ metadata }));

    const found = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(found.metadata).toEqual(metadata);
  });

  it('should load the owning channel through the relation', async () => {
    const saved = await videoRepository.save(buildVideo());
    const found = await videoRepository.findOneOrFail({
      where: { id: saved.id },
      relations: { channel: true },
    });

    expect(found.channel.id).toBe(channel.id);
  });
});
