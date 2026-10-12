# Test fixtures

## `sample.mp4`

3-second, 320x240, 10 fps H.264 + AAC clip (~40 KB) used by the media-probe,
worker and video e2e tests. Regenerate it inside the API container (which ships
FFmpeg) with:

```bash
docker compose exec nestjs-api ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i testsrc=duration=3:size=320x240:rate=10 \
  -f lavfi -i sine=frequency=440:duration=3 \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast -c:a aac -b:a 64k \
  -shortest -movflags +faststart -map_metadata -1 -fflags +bitexact \
  test/fixtures/sample.mp4
```
