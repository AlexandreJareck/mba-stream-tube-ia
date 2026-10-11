import {
  InvalidMediaError,
  parseProbeOutput,
  thumbnailTimestamp,
} from './media-probe.service';

describe('parseProbeOutput', () => {
  const output = (streams: object[], format: object) =>
    JSON.stringify({ streams, format });

  it('should map duration and video/audio metadata', () => {
    const result = parseProbeOutput(
      output(
        [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '30000/1001',
          },
          { codec_type: 'audio', codec_name: 'aac' },
        ],
        { format_name: 'mov,mp4', duration: '12.5', bit_rate: '800000' },
      ),
    );

    expect(result).toEqual({
      durationSeconds: 12.5,
      metadata: {
        format_name: 'mov,mp4',
        bit_rate: 800000,
        width: 1920,
        height: 1080,
        video_codec: 'h264',
        audio_codec: 'aac',
        frame_rate: 29.97,
      },
    });
  });

  it('should accept a video without audio', () => {
    const result = parseProbeOutput(
      output([{ codec_type: 'video', codec_name: 'vp9' }], { duration: '3' }),
    );
    expect(result.metadata.audio_codec).toBeNull();
  });

  it('should reject output without a video stream', () => {
    expect(() =>
      parseProbeOutput(output([{ codec_type: 'audio' }], { duration: '3' })),
    ).toThrow(InvalidMediaError);
  });

  it.each([undefined, '0', 'N/A'])(
    'should reject a duration of %s',
    (duration) => {
      expect(() =>
        parseProbeOutput(output([{ codec_type: 'video' }], { duration })),
      ).toThrow(InvalidMediaError);
    },
  );

  it('should reject unparseable output', () => {
    expect(() => parseProbeOutput('not json')).toThrow(InvalidMediaError);
  });
});

describe('thumbnailTimestamp', () => {
  it('should use 1 s for clips of 2 s or more', () => {
    expect(thumbnailTimestamp(3600)).toBe(1);
    expect(thumbnailTimestamp(2)).toBe(1);
  });

  it('should use the midpoint of very short clips', () => {
    expect(thumbnailTimestamp(1.5)).toBe(0.75);
  });
});
