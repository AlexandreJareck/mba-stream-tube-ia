import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import type { VideoMetadata } from '../entities/video.entity';
import { THUMBNAIL_WIDTH } from '../videos.constants';

const PROBE_TIMEOUT_MS = 60_000;
const THUMBNAIL_TIMEOUT_MS = 120_000;
const STDERR_TAIL_CHARS = 2_000;

/** The input is not a usable video (no video stream / no duration / undecodable). */
export class InvalidMediaError extends Error {
  constructor(reason: string) {
    super(`Invalid media: ${reason}`);
    this.name = 'InvalidMediaError';
  }
}

/** ffprobe/ffmpeg failed for a reason that may be transient (network, timeout…). */
export class MediaToolError extends Error {
  constructor(tool: string, detail: string) {
    super(`${tool} failed: ${detail}`);
    this.name = 'MediaToolError';
  }
}

export interface ProbeResult {
  durationSeconds: number;
  metadata: VideoMetadata;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string; bit_rate?: string };
}

// ffmpeg messages that mean "this input is not a decodable media file".
const INVALID_INPUT_PATTERNS = [
  /Invalid data found when processing input/i,
  /moov atom not found/i,
  /could not find codec parameters/i,
  /Invalid argument/i,
];

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return Math.round((num / den) * 1000) / 1000;
}

/** Maps ffprobe's JSON (`-show_format -show_streams`) to the persisted metadata. */
export function parseProbeOutput(json: string): ProbeResult {
  let output: FfprobeOutput;
  try {
    output = JSON.parse(json) as FfprobeOutput;
  } catch {
    throw new InvalidMediaError('unreadable probe output');
  }
  const video = output.streams?.find((s) => s.codec_type === 'video');
  if (!video) {
    throw new InvalidMediaError('no video stream');
  }
  const durationSeconds = toNumber(output.format?.duration);
  if (durationSeconds === null || durationSeconds <= 0) {
    throw new InvalidMediaError('missing or non-positive duration');
  }
  const audio = output.streams?.find((s) => s.codec_type === 'audio');
  return {
    durationSeconds,
    metadata: {
      format_name: output.format?.format_name ?? null,
      bit_rate: toNumber(output.format?.bit_rate),
      width: video.width ?? null,
      height: video.height ?? null,
      video_codec: video.codec_name ?? null,
      audio_codec: audio?.codec_name ?? null,
      frame_rate: parseFrameRate(video.r_frame_rate),
    },
  };
}

/** Deterministic thumbnail instant: 1 s in, or the midpoint of very short clips. */
export function thumbnailTimestamp(durationSeconds: number): number {
  return durationSeconds >= 2 ? 1 : durationSeconds / 2;
}

/**
 * Runs ffprobe/ffmpeg as child processes (argument arrays, no shell) against an
 * input URL, so the source is read with HTTP Range requests and never loaded
 * into Node memory (phase-03-videos/TD-04).
 */
@Injectable()
export class MediaProbeService {
  async probe(inputUrl: string): Promise<ProbeResult> {
    const stdout = await this.run(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        inputUrl,
      ],
      PROBE_TIMEOUT_MS,
    );
    return parseProbeOutput(stdout);
  }

  async extractThumbnail(
    inputUrl: string,
    durationSeconds: number,
    outputPath: string,
  ): Promise<void> {
    await this.run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-ss',
        thumbnailTimestamp(durationSeconds).toFixed(3),
        '-i',
        inputUrl,
        '-frames:v',
        '1',
        '-vf',
        `scale=${THUMBNAIL_WIDTH}:-2`,
        '-q:v',
        '3',
        outputPath,
      ],
      THUMBNAIL_TIMEOUT_MS,
    );
  }

  private run(
    tool: string,
    args: string[],
    timeoutMs: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(tool, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new MediaToolError(tool, `timed out after ${timeoutMs} ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new MediaToolError(tool, error.message));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(Buffer.concat(stdout).toString());
          return;
        }
        const detail = stderr.trim() || `exit code ${code}`;
        reject(
          INVALID_INPUT_PATTERNS.some((pattern) => pattern.test(stderr))
            ? new InvalidMediaError(detail)
            : new MediaToolError(tool, detail),
        );
      });
    });
  }
}
