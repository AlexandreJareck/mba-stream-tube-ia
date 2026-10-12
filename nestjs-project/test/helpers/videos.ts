import request from 'supertest';
import { StorageService } from '../../src/storage/storage.service';
import { buildStorageKeys } from '../../src/videos/upload-plan.util';
import { bodyOf, TestApp, VideoUploadBody } from './app';

/** 3-byte JPEG signature + padding: enough for content-type/signature checks. */
export const FAKE_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(256, 1),
]);

/**
 * Creates a draft through the API and marks it ready directly in the DB with
 * its source and thumbnail objects in MinIO — isolates playback tests from
 * the asynchronous worker.
 */
export async function seedReadyVideo(
  ctx: TestApp,
  token: string,
  source: Buffer,
): Promise<{ id: string; publicId: string }> {
  const res = await request(ctx.app.getHttpServer())
    .post('/channels/me/videos')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      title: 'Ready clip',
      filename: 'ready clip ção.mp4',
      content_type: 'video/mp4',
      size_bytes: source.length,
    })
    .expect(201);
  const { id, public_id: publicId } = bodyOf<VideoUploadBody>(res);

  const keys = buildStorageKeys(id);
  const storage = ctx.app.get(StorageService);
  await storage.putObject(keys.source, source, 'video/mp4', source.length);
  await storage.putObject(
    keys.thumbnail,
    FAKE_JPEG,
    'image/jpeg',
    FAKE_JPEG.length,
  );
  await ctx.dataSource.query(
    `UPDATE videos SET status = 'ready', upload_id = NULL, upload_expires_at = NULL,
       processing_run = 1, duration_seconds = 3, thumbnail_key = $2,
       metadata = '{"width":320,"height":240}'::jsonb, processed_at = now()
     WHERE id = $1`,
    [id, keys.thumbnail],
  );
  return { id, publicId };
}

export async function seedDraftVideo(
  ctx: TestApp,
  token: string,
): Promise<{ id: string; publicId: string }> {
  const res = await request(ctx.app.getHttpServer())
    .post('/channels/me/videos')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      title: 'Draft clip',
      filename: 'draft.mp4',
      content_type: 'video/mp4',
      size_bytes: 1024,
    })
    .expect(201);
  const body = bodyOf<VideoUploadBody>(res);
  return { id: body.id, publicId: body.public_id };
}
