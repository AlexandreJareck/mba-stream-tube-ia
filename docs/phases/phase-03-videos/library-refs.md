---
libs:
  "bullmq":
    version: "^6.3.12"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-11T18:27:44-03:00"
  "@nestjs/bullmq":
    version: "^12.0.0"
    context7_id: "/taskforcesh/bullmq (guide/nestjs) + /nestjs/docs.nestjs.com (application/queues)"
    fetched_at: "2026-10-11T18:27:44-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1149.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-11T18:27:44-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1149.0"
    context7_id: "/aws/aws-sdk-js-v3 (packages/s3-request-presigner)"
    fetched_at: "2026-10-11T18:27:44-03:00"
  "ffmpeg/ffprobe (OS binaries)":
    version: "Debian bookworm/trixie package of the node:25 slim base image"
    context7_id: "/websites/ffmpeg_documentation"
    fetched_at: "2026-10-11T18:27:44-03:00"
  "minio (server + mc)":
    version: "minio/minio + minio/mc images (pinned in compose.yaml)"
    context7_id: "/minio/docs, /minio/mc"
    fetched_at: "2026-10-11T18:27:44-03:00"
  "@nestjs/throttler":
    version: "^6.5.0 (installed)"
    context7_id: "inherited — phase-02-auth/TD-08"
    fetched_at: "2026-10-11T18:27:44-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-11T18:27:05-03:00"
---

# phase-03-videos — Library references

> **How these references were obtained.** The project rule (`CLAUDE.md` → Library Documentation Lookup) mandates Context7. The Context7 **MCP** server is not configured in this workspace (`.mcp.json` only declares `postgres`), so the agent queried the same Context7 index through its public HTTP API (`GET https://context7.com/api/v1/search?query=…` and `GET https://context7.com/api/v1/{library-id}?type=txt&topic=…`). Raw excerpts were kept in the session scratchpad; the distilled, version-relevant facts are recorded below. Versions were checked with `npm view` on 2026-10-11 and against peer-dependency ranges.

## Version compatibility check

| Package | Latest (npm view) | Peer constraints | Compatible with project? |
|---|---|---|---|
| `@nestjs/bullmq` | 12.0.0 | `@nestjs/common`/`core` `^10 \|\| ^11 \|\| ^12`, `bullmq ^3–^6` | Yes (Nest 11.x installed) |
| `bullmq` | 6.3.12 | `ioredis >=5` (bundled dependency) | Yes |
| `@aws-sdk/client-s3` | 3.1149.0 | none | Yes (Node ≥ 18; container Node 25) |
| `@aws-sdk/s3-request-presigner` | 3.1149.0 | none | Yes — must match client-s3 minor |
| `fluent-ffmpeg` | 2.1.3 — **deprecated** (npm `deprecated` field, 2025-05-22) | — | Rejected (TD-04 Option B) |
| `nanoid` | 6.0.2 — `"type": "module"` (ESM-only) | — | Rejected (TD-07 Option B) |

**Discrepancy flagged:** the NestJS docs page `application/queues` (Context7 `/nestjs/docs.nestjs.com`) still shows `BullModule.forRootAsync({ useFactory: () => ({ redis: {...} }) })`, which is the **legacy `@nestjs/bull`** shape. For `@nestjs/bullmq` (BullMQ guide `guide/nestjs`), the option key is **`connection`** (`{ connection: { host, port } }`). The implementation follows the BullMQ/`@nestjs/bullmq` shape.

### bullmq

- **Producer:** `queue.add(name, data, opts)`; `opts.jobId` — custom id; adding a job whose id already exists returns the existing job (no duplicate). Custom ids must not contain `:` (BullMQ reserves it as key separator) → use `video-process-{uuid}`.
- **Retries:** `opts.attempts: 3`, `opts.backoff: { type: 'exponential', delay: 10_000 }` (delays 10 s, 20 s …).
- **No-retry failures:** throw `new UnrecoverableError(msg)` from the processor → job goes straight to the failed set regardless of `attempts`.
- **Retention:** `removeOnComplete: { age, count }`, `removeOnFail: { age }` — the failed set with age 7 days (604800 s) is the dead-letter store (TD-06).
- **Stalled jobs:** if a worker dies holding a job, the stalled checker moves it back to wait (at-least-once; `maxStalledCount` default 1) — consumer must be idempotent (TD-05/TD-06).
- **Graceful shutdown:** `await worker.close()` waits for active jobs; hook it on SIGTERM (Nest `enableShutdownHooks()` triggers `WorkerHost` close).
- **Events:** `worker.on('failed', (job, err) => …)` / `@OnWorkerEvent('failed')` — `job.attemptsMade` vs `job.opts.attempts` tells whether the failure is final.
- **Repeatable/scheduled jobs:** `queue.upsertJobScheduler(id, { every: ms }, { name, data })` — used for the abandoned-upload sweeper (TD-03).

### @nestjs/bullmq

- `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: (cfg) => ({ connection: { host, port } }) })` in the owning module (global connection).
- `BullModule.registerQueue({ name: 'video-processing' })`; producer injects `@InjectQueue('video-processing') queue: Queue`.
- Consumer: `@Processor('video-processing', { concurrency })` on a class `extends WorkerHost` implementing `async process(job: Job)`; event hooks via `@OnWorkerEvent('failed')`.
- Processors are only instantiated where the provider is registered → register the processor **only in the worker module** so the API process never consumes jobs.

### @aws-sdk/client-s3 / @aws-sdk/s3-request-presigner

- Client: `new S3Client({ region, endpoint, forcePathStyle: true, credentials })` — `forcePathStyle` is required for MinIO (bucket in path, not subdomain).
- Multipart: `CreateMultipartUploadCommand({ Bucket, Key, ContentType })` → `UploadId`; `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })` presigned with `getSignedUrl(client, command, { expiresIn: 3600 })`; `ListPartsCommand` (paginated, ≤1000 parts per page on S3); `CompleteMultipartUploadCommand({ ..., MultipartUpload: { Parts: [{ PartNumber, ETag }] } })`; `AbortMultipartUploadCommand`.
- Verification: `HeadObjectCommand` → `ContentLength`, `ContentType`.
- Reads: `GetObjectCommand({ Bucket, Key, Range: 'bytes=start-end' })` → `Body` is a Node `Readable` (SdkStream) — pipe it, never buffer; always consume or destroy the body to free the socket.
- Presigned URLs embed the endpoint host in the signature → a client outside Docker needs URLs signed with the **public** endpoint; containers use the internal `http://minio:9000` endpoint (TD-03).
- Limits (AWS S3 multipart limits page): 10,000 parts; part 5 MiB–5 GiB, last part may be smaller; SigV4 presigned URLs max 7 days.

### ffmpeg / ffprobe

- Metadata: `ffprobe -v error -print_format json -show_format -show_streams <input>` → `format.duration`, `format.size`, `format.bit_rate`, `streams[]` (`codec_type`, `codec_name`, `width`, `height`, `r_frame_rate`).
- Thumbnail: `ffmpeg -ss <t> -i <input> -frames:v 1 -vf scale=<w>:-2 -q:v 3 -y out.jpg` — input-side `-ss` seeks (HTTP input uses Range requests, so a 10 GB source is not downloaded).
- Inputs over HTTP(S) are supported by the `http` protocol; seeking issues `Range` requests to the presigned URL.

### MinIO server / mc

- Thresholds: 10,000 parts per upload; part 5 MiB–5 TiB; optimal part size 64–512 MiB.
- `mc alias set local http://minio:9000 <user> <pass>`; `mc mb --ignore-existing local/<bucket>`; bucket stays private unless `mc anonymous set` is used (it is not).
- Stale multipart uploads are expired server-side by `MINIO_API_STALE_UPLOADS_EXPIRY` (default 24h, cleanup interval 6h — configuration reference); set explicitly in Compose as a safety net (TD-03).
- CORS for browser multipart (`ETag` exposure) is a client concern of a later phase; MinIO allows all origins by default (`MINIO_API_CORS_ALLOW_ORIGIN=*`).

### NestJS (inherited framework — referenced APIs)

- `StreamableFile(readable, { type, length, disposition })` — streams without buffering; for `206` responses the controller sets `@Res({ passthrough: true })` status and headers (`Content-Range`, `Accept-Ranges`).
- `NestFactory.createApplicationContext(WorkerModule)` — standalone app (no HTTP listener) for the worker; `app.enableShutdownHooks()`.
- `@SkipThrottle()` from `@nestjs/throttler` exempts a route from the global `ThrottlerGuard` (inherited TD-08).
- RFC 9110 §14: `Range: bytes=a-b | a- | -n`; `206` + `Content-Range: bytes a-b/size`; unsatisfiable → `416` + `Content-Range: bytes */size`; multiple ranges may be ignored (serve `200` full or first range).
