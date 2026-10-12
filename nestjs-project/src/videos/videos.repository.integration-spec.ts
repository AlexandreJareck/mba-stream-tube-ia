import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { InvalidVideoStatusException } from '../common/exceptions/domain.exception';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { buildDraftVideo, createUserWithChannel } from '../test/video-fixtures';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { PUBLIC_ID_GENERATOR, VideosRepository } from './videos.repository';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosRepository (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let repository: VideosRepository;
  let channelId: string;
  const generator = jest.fn<string, []>();

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([Video]),
      ],
      providers: [
        VideosRepository,
        { provide: PUBLIC_ID_GENERATOR, useValue: generator },
      ],
    }).compile();
    dataSource = module.get(DataSource);
    repository = module.get(VideosRepository);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    ({
      channel: { id: channelId },
    } = await createUserWithChannel(dataSource));
    let counter = 0;
    generator.mockReset();
    generator.mockImplementation(
      () => `id${String(++counter).padStart(9, '0')}`,
    );
  });

  describe('insertDraft', () => {
    it('should insert a draft with a generated public id', async () => {
      const video = await repository.insertDraft(buildDraftVideo(channelId));

      expect(video.status).toBe(VideoStatus.DRAFT);
      expect(video.public_id).toBe('id000000001');
    });

    it('should regenerate the public id when it collides', async () => {
      generator
        .mockReturnValueOnce('collidingId')
        .mockReturnValueOnce('collidingId')
        .mockReturnValueOnce('freshUnique');

      const first = await repository.insertDraft(buildDraftVideo(channelId));
      const second = await repository.insertDraft(buildDraftVideo(channelId));

      expect(first.public_id).toBe('collidingId');
      expect(second.public_id).toBe('freshUnique');
      expect(generator).toHaveBeenCalledTimes(3);
    });

    it('should give up after repeated collisions', async () => {
      generator.mockReturnValue('alwaysSame1');
      await repository.insertDraft(buildDraftVideo(channelId));

      await expect(
        repository.insertDraft(buildDraftVideo(channelId)),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });
    });
  });

  describe('transition', () => {
    it('should apply a valid transition from the expected status', async () => {
      const video = await repository.insertDraft(buildDraftVideo(channelId));

      const applied = await repository.transition(
        video.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
        { incrementRun: true, patch: { upload_id: null } },
      );

      const reloaded = await repository.findById(video.id);
      expect(applied).toBe(true);
      expect(reloaded).toMatchObject({
        status: VideoStatus.PROCESSING,
        processing_run: 1,
        upload_id: null,
      });
    });

    it('should not touch the row when the status differs', async () => {
      const video = await repository.insertDraft(buildDraftVideo(channelId));

      const applied = await repository.transition(
        video.id,
        VideoStatus.PROCESSING,
        VideoStatus.READY,
      );

      expect(applied).toBe(false);
      expect((await repository.findById(video.id))?.status).toBe(
        VideoStatus.DRAFT,
      );
    });

    it('should let exactly one of two concurrent transitions win', async () => {
      const video = await repository.insertDraft(buildDraftVideo(channelId));

      const results = await Promise.all([
        repository.transition(
          video.id,
          VideoStatus.DRAFT,
          VideoStatus.PROCESSING,
          {
            incrementRun: true,
          },
        ),
        repository.transition(
          video.id,
          VideoStatus.DRAFT,
          VideoStatus.PROCESSING,
          {
            incrementRun: true,
          },
        ),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await repository.findById(video.id))?.processing_run).toBe(1);
    });

    it('should honor the expected processing run', async () => {
      const video = await repository.insertDraft(buildDraftVideo(channelId));
      await repository.transition(
        video.id,
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
        { incrementRun: true },
      );

      const stale = await repository.transition(
        video.id,
        VideoStatus.PROCESSING,
        VideoStatus.READY,
        { expectedRun: 0 },
      );
      const current = await repository.transition(
        video.id,
        VideoStatus.PROCESSING,
        VideoStatus.READY,
        { expectedRun: 1 },
      );

      expect([stale, current]).toEqual([false, true]);
    });

    it('should reject transitions outside the state machine', async () => {
      await expect(
        repository.transition('any', VideoStatus.DRAFT, VideoStatus.READY),
      ).rejects.toBeInstanceOf(InvalidVideoStatusException);
    });
  });

  describe('queries', () => {
    it('should find a video only within its owning channel', async () => {
      const video = await repository.insertDraft(buildDraftVideo(channelId));
      const { channel: other } = await createUserWithChannel(dataSource);

      await expect(
        repository.findOwned(video.id, channelId),
      ).resolves.toMatchObject({
        id: video.id,
      });
      await expect(
        repository.findOwned(video.id, other.id),
      ).resolves.toBeNull();
    });

    it('should resolve public ids only for ready videos', async () => {
      const video = await repository.insertDraft(buildDraftVideo(channelId));

      await expect(
        repository.findReadyByPublicId(video.public_id),
      ).resolves.toBeNull();

      await dataSource.query(
        `UPDATE videos SET status = 'ready' WHERE id = $1`,
        [video.id],
      );
      await expect(
        repository.findReadyByPublicId(video.public_id),
      ).resolves.toMatchObject({ id: video.id });
    });

    it('should list only drafts whose upload session expired', async () => {
      const past = new Date(Date.now() - 60_000);
      const expired = await repository.insertDraft(
        buildDraftVideo(channelId, { upload_expires_at: past }),
      );
      await repository.insertDraft(buildDraftVideo(channelId));

      const found = await repository.findExpiredDrafts(new Date(), 10);

      expect(found.map((v) => v.id)).toEqual([expired.id]);
    });
  });
});
