import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { InvalidMediaError, MediaProbeService } from './media-probe.service';

const execFileAsync = promisify(execFile);

const FIXTURE = join(__dirname, '../../../test/fixtures/sample.mp4');

describe('MediaProbeService (integration, real FFmpeg)', () => {
  const service = new MediaProbeService();
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'media-probe-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('should extract duration and metadata from the fixture', async () => {
    const result = await service.probe(FIXTURE);

    expect(result.durationSeconds).toBeGreaterThanOrEqual(2.9);
    expect(result.durationSeconds).toBeLessThanOrEqual(3.1);
    expect(result.metadata).toMatchObject({
      width: 320,
      height: 240,
      video_codec: 'h264',
      audio_codec: 'aac',
      frame_rate: 10,
    });
  });

  it('should write a 640px-wide JPEG thumbnail', async () => {
    const output = join(workDir, 'thumb.jpg');

    await service.extractThumbnail(FIXTURE, 3, output);

    const jpeg = await readFile(output);
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      output,
    ]);
    expect(stdout.trim()).toBe('640,480');
  });

  it('should reject a text file disguised as mp4', async () => {
    const fake = join(workDir, 'fake.mp4');
    await writeFile(fake, 'this is definitely not a video\n'.repeat(200));

    await expect(service.probe(fake)).rejects.toBeInstanceOf(InvalidMediaError);
  });
});
