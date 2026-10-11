import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Video } from '../videos/entities/video.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1791755538915 } from './migrations/1791755538915-CreateVideos';
import { createTestDataSource } from '../test/create-test-data-source';

const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
];

// DROP TABLE … CASCADE leaves enum types behind; a DB migrated by the CLI
// would then fail to re-run the migrations ("type … already exists").
const MANAGED_ENUM_TYPES = [
  'verification_tokens_type_enum',
  'videos_status_enum',
];

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken, Video],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1791755538915,
        ],
      },
    );

    await dataSource.initialize();

    // A single statement: parallel DROP … CASCADE on FK-linked tables deadlocks.
    const tables = [...MANAGED_TABLES, 'migrations']
      .map((table) => `"${table}"`)
      .join(', ');
    await dataSource.query(`DROP TABLE IF EXISTS ${tables} CASCADE`);
    const types = MANAGED_ENUM_TYPES.map((type) => `"public"."${type}"`).join(
      ', ',
    );
    await dataSource.query(`DROP TYPE IF EXISTS ${types}`);
  });

  afterAll(async () => {
    // The revert tests undo migrations, leaving tables missing.
    // Re-apply so the shared DB is fully migrated when subsequent suites run.
    await dataSource.runMigrations();
    await dataSource.destroy();
  });

  it('should apply all migrations and create all managed tables', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(3);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'videos',
    ]);
  });

  it('should create the videos FK, unique public id and size check', async () => {
    const constraints = await dataSource.query<
      { conname: string; contype: string }[]
    >(
      `SELECT conname, contype FROM pg_constraint
       WHERE conrelid = 'videos'::regclass ORDER BY conname`,
    );
    expect(constraints.map((c) => c.contype).sort()).toEqual(['c', 'f', 'p']);

    const indexes = await dataSource.query<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'videos'`,
    );
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        'UQ_videos_public_id',
        'UQ_videos_storage_key',
        'IDX_videos_channel_id',
        'IDX_videos_status_upload_expires_at',
      ]),
    );
  });

  it('should revert the videos migration and drop its table and enum', async () => {
    await dataSource.undoLastMigration();

    const tables = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'videos'`,
    );
    expect(tables).toHaveLength(0);

    const types = await dataSource.query<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typname = 'videos_status_enum'`,
    );
    expect(types).toHaveLength(0);
  });

  it('should revert the last migration and remove token tables', async () => {
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['refresh_tokens', 'verification_tokens']],
    );
    expect(result).toHaveLength(0);
  });
});
