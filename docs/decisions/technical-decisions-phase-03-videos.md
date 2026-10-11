---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-11
scope_description: "Backend for video upload and processing: object storage (S3/MinIO), processing queue and separate FFmpeg worker, direct multipart upload up to 10 GB with draft pre-registration, metadata/thumbnail extraction, collision-free public identifier, Range/206 streaming, download and the draft → processing → ready | failed lifecycle."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — receives the `videos` module (entity, migration, upload/completion/streaming/download endpoints), the S3/MinIO storage adapter, the queue producer, and the separate FFmpeg worker entrypoint; `compose.yaml` gains MinIO, the queue broker and the worker container.
- `next-frontend/` — no open decision in this document: all video UI (upload, player, management) is explicitly out of scope for Phase 03 (`docs/phase-03-handoff/specification.md` §12). The contracts defined here are exported through the existing OpenAPI pipeline (inherited `openapi-docs-nestjs` decision) and will be consumed by a later phase.

_Given constraints (not reopened):_ S3-compatible object storage — MinIO in development, S3 in production (`specification.md` §6); NestJS 11 + TypeORM + PostgreSQL 17; global JWT guard, domain exception filter, `ValidationPipe`, throttler, migrations and Swagger setup from Phases 01/02 and the `openapi-docs-nestjs` task.

_Research method (AI-assisted, observable):_ options and APIs were checked against the installed manifests (`nestjs-project/package.json`), against the latest published versions (`npm view`, 2026-10-11) and against official documentation retrieved through the **Context7 HTTP API** (`context7.com/api/v1/...` — the Context7 MCP server is not configured in this workspace's `.mcp.json`, so the same index was queried over HTTP; see `docs/phases/phase-03-videos/library-refs.md`). Limits not indexed by Context7 were read from the vendor pages cited per TD.

---

## TD-01: Processing Queue Technology and NestJS Integration

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram leaves the Message Queue as "TBD". The API must publish a processing job after upload completion and a worker in a separate container must consume it with retries and visibility of failed jobs. The choice determines the new Compose service, the NestJS integration module and how idempotency/retries are expressed (TD-06).

**Options:**

### Option A: BullMQ on Redis (`@nestjs/bullmq`)
- Redis-backed job queue with official NestJS module (`BullModule.forRootAsync`, `registerQueue`, `@InjectQueue`, `@Processor` + `WorkerHost`). Jobs carry options for `jobId`, `attempts`, `backoff`, `removeOnComplete/removeOnFail`; failed jobs remain inspectable.
- **Pros:** Recommended by the project's own `nestjs-best-practices` rule (`micro-use-queues`). Native retries/backoff, custom `jobId` deduplication, stalled-job recovery after worker crashes, graceful `worker.close()`. `@nestjs/bullmq@12` declares peer support for Nest 11 and `bullmq@^6`.
- **Cons:** Adds Redis as a new stateful service. Enqueue is not atomic with the PostgreSQL transaction (requires an idempotent re-publish path — see TD-06/TD-09).

### Option B: RabbitMQ (`@nestjs/microservices` RMQ transport or `amqplib`)
- AMQP broker with durable queues, acks and dead-letter exchanges.
- **Pros:** Mature broker semantics, DLX built in, language-agnostic consumers.
- **Cons:** Retry with backoff requires delayed-exchange plugin or TTL+DLX topology; Nest RMQ transport is request/event oriented (no job state, no per-job retry counters); heavier ops footprint for a single job type.

### Option C: PostgreSQL-backed queue (`pg-boss`)
- Jobs stored in PostgreSQL tables; no new infrastructure.
- **Pros:** Enqueue can share the DB transaction with the status change (atomic). Retries, singleton keys and dead-letter supported.
- **Cons:** No official NestJS module; polling load on the primary DB that also serves the API; diverges from the project's documented best-practice rule; queue load competes with OLTP traffic as uploads scale.

**Recommendation:** **Option A (BullMQ + Redis via `@nestjs/bullmq`)** — it is the queue the project's own best-practices skill prescribes, has first-class Nest 11 support and covers retries, deduplication by `jobId`, stalled-job recovery and failed-job retention natively; the non-atomic enqueue is closed by the idempotent completion/re-publish design in TD-06.

**Decision:** A (BullMQ + Redis via `@nestjs/bullmq`)
**Libraries:** `bullmq@^6.3.x`, `@nestjs/bullmq@^12.0.x`, `ioredis` (transitive via bullmq)

---

## TD-02: Direct Upload Protocol for Files up to 10 GB

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** The file must never pass through the API (`specification.md` §4.1) and the project plan asks that uploads can resume after connection failures (`project-plan.md` §4). The protocol is a contract between the API and any future client: start → transfer → complete. Depends on the S3 limits: part size 5 MiB–5 GiB (last part unbounded below), max 10,000 parts (AWS S3 multipart limits page; MinIO thresholds page).

**Options:**

### Option A: S3 multipart upload with presigned `UploadPart` URLs
- `POST /videos` creates the `draft` row and calls `CreateMultipartUpload`; the API returns `uploadId`-backed part URLs (one presigned `UploadPart` URL per part, computed from the declared size and a fixed part size). The client `PUT`s parts directly to storage and then calls the completion endpoint with the `ETag` of each part; the API calls `ListParts`/`CompleteMultipartUpload` and verifies the object with `HeadObject`.
- **Pros:** Bytes never touch the API; parallel and resumable (parts are independent; already-uploaded parts are listed with `ListParts` and only missing ones re-signed). 10 GiB with 64 MiB parts = 160 parts (far below 10,000). Same protocol on MinIO and S3.
- **Cons:** Client must split the file and collect ETags (CORS must expose `ETag`); orphan multipart uploads must be cleaned up (TD-03); more endpoints than a single PUT.

### Option B: Single presigned `PUT` (or presigned `POST` policy)
- One URL for the whole object.
- **Pros:** Simplest client; one request.
- **Cons:** S3 caps a single PUT at 5 GiB — a 10 GB file cannot be uploaded; no resume.

### Option C: tus resumable protocol (tusd sidecar with S3 backend)
- A tus server receives chunks and writes to S3.
- **Pros:** Standardized resume semantics and mature clients.
- **Cons:** Bytes flow through an extra server we operate (tusd), adding a container, auth hooks and a second upload path; not S3-native.

**Recommendation:** **Option A (S3 multipart with presigned part URLs)** — the only option that keeps the API out of the data path while supporting >5 GiB and resume; contract parameters: part size 64 MiB (MinIO's documented optimal range 64–512 MiB, S3-valid), part URLs valid 1 h and re-signable, upload session valid 24 h, completion verified with `ListParts` + `HeadObject` size equality.

**Decision:** A (S3 multipart upload with presigned `UploadPart` URLs)
**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-03: Bucket Layout, Object Keys, Lifecycle and Access Policy

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Videos and thumbnails share the storage service. Keys must be deterministic (idempotent worker writes, TD-06) and must not reflect user-controlled names. Abandoned multipart uploads consume storage until aborted. Because containers talk to MinIO as `minio:9000` (Compose rule) while a client outside Docker reaches it at a public endpoint, presigned URLs must be signed for the host the client will use.

**Options:**

### Option A: Single private bucket, prefix-per-video keys, app-level cleanup
- Bucket `streamtube-videos` (private, no anonymous policy). Keys `videos/{videoId}/source` and `videos/{videoId}/thumbnail.jpg` (internal UUID, never the uploaded filename). Two S3 clients: internal endpoint (`http://minio:9000`) for server-side calls and a public endpoint (`S3_PUBLIC_ENDPOINT`) used only for presigning client URLs. Abandoned uploads: MinIO stale-upload expiry (`MINIO_API_STALE_UPLOADS_EXPIRY=24h`) as a safety net plus an application sweeper that aborts the multipart upload and marks the draft `failed` (`UPLOAD_EXPIRED`) once its upload session expires.
- **Pros:** One bucket to provision; private by default; deterministic keys; cleanup is observable in the DB, not only in storage.
- **Cons:** Requires a scheduled sweeper job; two endpoint settings to configure.

### Option B: Separate buckets per artifact (`uploads`, `videos`, `thumbnails`)
- Upload lands in `uploads`, worker copies to `videos`.
- **Pros:** Lifecycle rules per bucket (e.g., expire everything in `uploads`).
- **Cons:** A server-side copy of up to 10 GB per video doubles I/O and storage temporarily; more provisioning.

### Option C: Public-read bucket for thumbnails
- Thumbnails served anonymously by storage URL.
- **Pros:** No API hop for thumbnails.
- **Cons:** Opens anonymous bucket access while video access rules (TD-08/TD-11) still apply to the source; exposes storage hostnames; premature before Phase 04 visibility rules.

**Recommendation:** **Option A (single private bucket, prefix-per-video, app-level cleanup)** — minimal provisioning, no 10 GB copies, deterministic keys for idempotency, and abandoned uploads become a visible state transition instead of silent storage garbage.

**Decision:** A (Single private bucket, prefix-per-video keys, app-level cleanup)
**Libraries:** `@aws-sdk/client-s3@^3.x`

---

## TD-04: Worker Execution Model and FFmpeg/ffprobe Usage

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Processing must run in a process/container separate from the API, without loading the input fully into memory (`specification.md` §4.3). The worker needs DB access (status/metadata), storage access and the queue.

**Options:**

### Option A: NestJS standalone application in the same codebase, separate container, `ffprobe`/`ffmpeg` spawned via `child_process`
- `src/worker.ts` boots `NestFactory.createApplicationContext(WorkerModule)` (no HTTP server) and reuses entities, config and storage services. The container uses the same dev image plus the Debian `ffmpeg` package. ffprobe/ffmpeg read the source through a short-lived presigned **internal** GET URL (HTTP input with Range seeking) — no full download, no Node buffering; output is a small JPEG written to a temp dir and uploaded.
- **Pros:** Reuses repository/entities/config (no duplicated schema); separate process and container; ffprobe's `-of json` output is parsed directly; no wrapper dependency.
- **Cons:** Same image carries ffmpeg (larger image); spawn arguments must be built safely (array args, no shell).

### Option B: `fluent-ffmpeg` wrapper
- Fluent API over the same binaries.
- **Pros:** Convenience helpers (`screenshots`, `ffprobe`).
- **Cons:** The upstream repository was archived and the package deprecated (2025); adds an unmaintained dependency for two commands.

### Option C: Separate worker project (other runtime/language)
- **Pros:** Full isolation of dependencies.
- **Cons:** Duplicates entity/schema knowledge and config validation; new toolchain, tests and Dockerfile; contradicts reuse of Phases 01/02 patterns.

**Recommendation:** **Option A (Nest standalone worker + direct `ffprobe`/`ffmpeg`)** — separate container as required while reusing the project's modules; streaming the input over a presigned internal URL avoids both full downloads and in-memory buffering of up to 10 GB.

**Decision:** A (NestJS standalone worker + direct `ffprobe`/`ffmpeg` via `child_process`)
**Libraries:** —

**Note:** `ffmpeg`/`ffprobe` are OS binaries installed in the worker image (Debian `ffmpeg` package), not npm libraries.

---

## TD-05: Processing Message Format, Versioning and Delivery Guarantees

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The job payload is a contract between the API (producer) and the worker (consumer) that may be deployed independently. Depends on TD-01.

**Options:**

### Option A: Minimal versioned claim-check payload `{ version: 1, videoId }`
- Job name `video.process`; payload carries only a schema version and the internal video id. The worker loads the current row from the DB (single source of truth) and rejects unknown versions as unrecoverable.
- **Pros:** No stale data in messages; tiny payload; version field allows evolving the contract; idempotency keyed on `videoId`.
- **Cons:** One extra DB read per job.

### Option B: Snapshot payload (storage key, declared size, MIME, channel id …)
- **Pros:** Worker can process without reading the row first.
- **Cons:** Duplicates DB state in the queue; snapshot can diverge after retries/reprocessing; larger contract surface to version.

**Recommendation:** **Option A (`video.process` v1 `{ version: 1, videoId }`, at-least-once)** — BullMQ delivers at-least-once (stalled jobs are re-run), so the consumer must be idempotent anyway; reading the row keeps the DB authoritative and the contract small.

**Decision:** A (`video.process` v1 claim-check `{ version: 1, videoId }`, at-least-once)
**Libraries:** `bullmq@^6.3.x`

---

## TD-06: Idempotency, Retries, Backoff and Permanently Failed Jobs

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance"

**Context:** Completion can be retried by clients; jobs can be redelivered after worker restarts; enqueue is not atomic with the DB transaction (TD-01). The spec requires no duplicate jobs, no state corruption and a defined destination for permanently failed jobs (`specification.md` §4.2–4.3).

**Options:**

### Option A: BullMQ-native — deterministic `jobId`, conditional state updates, failed set as DLQ
- Completion: conditional `UPDATE ... SET status='processing' WHERE id=:id AND status='draft'`; if the video is already `processing`/`ready`, the call returns the current state (idempotent) and re-adds the job with `jobId = video-process-{videoId}` (BullMQ ignores an add whose `jobId` already exists, so re-publish repairs a lost enqueue without duplicates). Worker: `attempts: 3`, exponential backoff starting at 10 s; invalid media throws `UnrecoverableError` (no retries); final failure handler sets `failed` with an internal `failure_reason`; failed jobs are retained (`removeOnFail` by age, 7 days) as the dead-letter set. Worker writes are idempotent (deterministic thumbnail key overwrite; final `UPDATE ... WHERE status='processing'`).
- **Pros:** No extra tables/queues; duplicate completions and redeliveries are harmless; failed jobs inspectable.
- **Cons:** DLQ is the failed set of the same queue (not a separate queue); a crash between DB update and enqueue is repaired only when completion is called again or by reprocess (TD-09).

### Option B: Transactional outbox table + relay
- Completion writes an `outbox` row in the same transaction; a relay publishes to the queue.
- **Pros:** Exactly-once hand-off from DB to queue.
- **Cons:** New table, relay process and polling; heavy for a single event type.

### Option C: Separate dead-letter queue
- Final failures moved to `video-process-dlq` by the worker.
- **Pros:** Explicit DLQ consumer possible.
- **Cons:** Custom move logic; duplicates what the failed set already provides.

**Recommendation:** **Option A (deterministic `jobId` + conditional updates + retained failed set)** — gives the required idempotency for double completion, redelivery and worker restarts with native primitives; the non-atomic gap is closed by the idempotent re-publish on repeated completion and by reprocess.

**Decision:** A (Deterministic `jobId` + compare-and-set updates + retained failed set)
**Libraries:** `bullmq@^6.3.x`

---

## TD-07: Unique Public Video Identifier

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a short, URL-safe, collision-free identifier (`project-plan.md` §4 "URL curta e única") distinct from the internal UUID, protected by a uniqueness constraint (`specification.md` §5). It becomes part of every public URL a client builds.

**Options:**

### Option A: 11-char random base64url from `crypto.randomBytes(8)` + unique index + retry
- 64 random bits encoded as base64url (YouTube-style length); generated in the service; `UNIQUE` constraint on `public_id`; on PG unique violation (`23505` on that column) regenerate and retry (pattern already used by `ChannelsService` nicknames).
- **Pros:** No dependency; non-enumerable; collision handled deterministically by the DB constraint.
- **Cons:** Retry loop needed (collision probability negligible).

### Option B: `nanoid` library
- **Pros:** Configurable alphabet/length.
- **Cons:** New dependency (ESM-only in recent majors, friction with the project's CommonJS ts-jest setup) for what `node:crypto` already provides.

### Option C: Expose the internal UUID
- **Pros:** Zero work.
- **Cons:** 36 chars, not "short"; couples public URLs to the primary key.

**Recommendation:** **Option A (crypto base64url, 11 chars, unique index + retry)** — short, unguessable and dependency-free, reusing the project's existing unique-violation retry pattern.

**Decision:** A (11-char base64url from `crypto.randomBytes(8)` + unique index + retry)
**Libraries:** —

---

## TD-08: Streaming and Download Delivery (Range/206)

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** The spec requires Range support, validated ranges and correct headers including `206`, plus an explicit, justified choice between redirect/signed URLs and proxying (`specification.md` §4.4). The architecture diagram shows the frontend streaming from object storage; the spec ranks the acceptance criteria above the diagram (§3). Depends on TD-03 (private bucket).

**Options:**

### Option A: API streams through (proxy) with its own Range validation
- `GET /videos/{publicId}/stream` parses and validates `Range` (single `bytes=` range; `416` with `Content-Range: bytes */size` when unsatisfiable), forwards the normalized range to `GetObject`, and pipes the storage stream to the response (`206`, `Content-Range`, `Accept-Ranges`, `Content-Length`, `Content-Type`). Download is the same pipe with `Content-Disposition: attachment`. Memory is constant (Node stream backpressure).
- **Pros:** Range semantics are owned, validated and testable in the API; storage stays private and its hostname never leaks; identical behavior on MinIO and S3; authorization checked on every request.
- **Cons:** Video bytes for playback/download traverse the API (bandwidth), deviating from the diagram's direct storage arrow; a CDN would later front the API route.

### Option B: API redirects (`302`) to a short-lived presigned GET URL
- Storage serves Range/206 natively; `ResponseContentDisposition=attachment` for downloads.
- **Pros:** Offloads bandwidth; matches the diagram.
- **Cons:** Range validation and headers are delegated to storage (the API cannot assert them); presigned URLs are bearer tokens shareable until expiry; public endpoint/host must be reachable and correctly signed in every environment.

### Option C: Public bucket URLs
- **Cons:** Anonymous storage access, no status/authorization checks; rejected by TD-03.

**Recommendation:** **Option A (API streaming proxy with validated Range)** — it is the only option where the API itself guarantees the required Range/206 contract and authorization while keeping storage private; bandwidth is the accepted trade-off for this phase and Option B remains a drop-in optimization behind the same routes.

**Decision:** A (API streaming proxy with validated Range)
**Libraries:** `@aws-sdk/client-s3@^3.x`

**Note:** Resolves `phase-03-videos` IC-1 — deliberate deviation from `docs/diagrams/software-arch.mermaid` (`frontend → storage "Streams"`) for Phase 03; the specification (§3 rank 1) requires the API to guarantee Range/206 and authorization. Option B (presigned redirect) stays a drop-in optimization behind the same routes.

---

## TD-09: Video Status State Machine and Failure Recovery

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The persisted lifecycle `draft → processing → ready | failed` must reject invalid transitions under concurrency (double completion, redelivery) and define how failed videos recover (`specification.md` §4–5, §8).

**Options:**

### Option A: Explicit transition table in the domain service + conditional (compare-and-set) updates
- Allowed: `draft→processing` (complete upload), `draft→failed` (upload expired), `processing→ready` / `processing→failed` (worker), `failed→processing` (owner reprocess, only when the source object exists). Each transition is a single `UPDATE ... WHERE id AND status = :from` checked by affected rows; anything else raises `INVALID_VIDEO_STATUS` (409). Failure info: `failure_reason` (internal code), `failed_at`, `processing_attempts`.
- **Pros:** Race-free without locks; small, unit-testable table; no dependency.
- **Cons:** Transitions are enforced by convention in one service (must not be bypassed).

### Option B: State-machine library (e.g., XState)
- **Pros:** Formal statechart.
- **Cons:** Dependency and abstraction for four states; still needs DB compare-and-set for concurrency.

### Option C: Free-form status updates
- **Cons:** No protection against invalid or racing transitions.

**Recommendation:** **Option A (transition table + compare-and-set updates, reprocess from `failed`)** — minimal, race-free and directly testable; reprocess gives a recovery path for transient permanent failures.

**Decision:** A (Explicit transition table + compare-and-set updates, reprocess from `failed`)
**Libraries:** —

---

## TD-10: Upload Limits, Validation and Abuse Controls

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Limits must be enforced in API, storage and worker (`specification.md` §8). Presigned part URLs cannot cap the bytes sent by themselves. The existing `ThrottlerGuard` is registered as a global `APP_GUARD` with 10 req/min, which would break playback (players issue many Range requests) and multipart part-URL refreshes.

**Options:**

### Option A: Declared metadata + server-side verification at three layers; per-route throttling
- API: `size_bytes` integer 1..10 GiB (10,737,418,240 bytes, inclusive), `content_type` allowlist (`video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`), title 1–100 chars. Storage/completion: parts must be exactly those listed by `ListParts`, sum and `HeadObject.ContentLength` must equal the declared size, otherwise `UPLOAD_INCOMPLETE`/`UPLOAD_SIZE_MISMATCH`. Worker: ffprobe must find a video stream with positive duration, else `failed` (`INVALID_MEDIA`). Throttling: stream/download/lookup routes `@SkipThrottle()`; upload-management routes keep the global limit with a named override suitable for part refresh.
- **Pros:** No byte inspection in the API; defense in depth; playback not throttled.
- **Cons:** A client can upload a non-video until the worker rejects it (cost bounded by the declared size cap).

### Option B: Trust client metadata only
- **Cons:** Storage size not verified; unsafe.

### Option C: API sniffs magic bytes of the first part
- **Pros:** Early rejection of non-videos.
- **Cons:** API must read object bytes (`GetObject` range) on completion — extra I/O; container signatures vary (mp4/mov/mkv/webm) and ffprobe already validates authoritatively.

**Recommendation:** **Option A (declared metadata + completion verification + ffprobe validation; skip throttling on playback routes)** — enforces the 10 GiB bound in all three layers without reading video bytes in the API and keeps the inherited throttler from breaking Range playback.

**Decision:** A (Declared metadata + completion verification + ffprobe validation; per-route throttling)
**Libraries:** `@nestjs/throttler@^6.x` (inherited)

**Note:** Resolves `phase-03-videos` AMB-1 — limit is **10 GiB = 10,737,418,240 bytes, inclusive** (superset of decimal 10 GB). Resolves ICC-1 — the inherited global `ThrottlerGuard` stays; video lookup/stream/download routes use `@SkipThrottle()`, upload-management routes keep the global default.

---

## TD-11: Video Access Authorization (who may start, complete, view, stream, download, reprocess)

**Scope:** Cross-layer

**Capability:** Transversal — covers: "URL única por vídeo, sem conflito com outros vídeos", "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** The project plan states anonymous users watch freely; visibility (public/unlisted) and the draft→publication flow belong to Phase 04. Phase 03 must still define who may operate on a video and what non-`ready` videos expose (`specification.md` §4.4, §8). The global JWT guard makes every route authenticated unless `@Public()`.

**Options:**

### Option A: Public read of `ready` videos by public id; owner-only management by internal id
- Anonymous/any user: `GET /videos/{publicId}`, `/stream`, `/download` succeed only for `ready` videos (others answer `404 VIDEO_NOT_FOUND`, so drafts are not discoverable). Owner (authenticated user whose channel owns the video): start upload, refresh part URLs, complete, read own video in any status (`GET /videos/{id}` by UUID — status polling), reprocess. Non-owner authenticated users get `404` on owner routes (no existence leak).
- **Pros:** No change to the global guard (no optional-auth); clear separation of public and management surfaces; drafts never served as ready.
- **Cons:** Ready videos are effectively "unlisted-public" until Phase 04 adds visibility/publication.

### Option B: Single public route with optional authentication
- Owner sees non-ready state on the same public route via an optional-auth guard.
- **Cons:** Requires a new optional-auth mechanism alongside the global guard; mixes public and management concerns.

### Option C: Authenticated-only access in Phase 03
- **Cons:** Contradicts "anonymous users can watch freely".

**Recommendation:** **Option A (public read of ready videos, owner-only management by UUID)** — honors anonymous viewing, keeps non-ready videos private, and requires no changes to the inherited global guard; Phase 04 layers visibility on top.

**Decision:** A (Public read of `ready` videos by public id; owner-only management by internal id)
**Libraries:** —

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Processing Queue Technology and NestJS Integration | BullMQ + Redis (`@nestjs/bullmq`) | A (BullMQ + Redis) |
| TD-02 | Cross-layer | Direct Upload Protocol for Files up to 10 GB | S3 multipart with presigned part URLs | A (S3 multipart + presigned parts) |
| TD-03 | Backend | Bucket Layout, Object Keys, Lifecycle and Access Policy | Single private bucket, prefix-per-video, app cleanup | A (single private bucket) |
| TD-04 | Backend | Worker Execution Model and FFmpeg/ffprobe Usage | Nest standalone worker + direct ffprobe/ffmpeg | A (Nest standalone worker + ffmpeg) |
| TD-05 | Backend | Processing Message Format, Versioning and Delivery Guarantees | `video.process` v1 claim-check, at-least-once | A (video.process v1 claim-check) |
| TD-06 | Backend | Idempotency, Retries, Backoff and Permanently Failed Jobs | Deterministic jobId + CAS updates + retained failed set | A (jobId + CAS + failed set) |
| TD-07 | Cross-layer | Unique Public Video Identifier | crypto base64url 11 chars + unique index + retry | A (crypto base64url 11 chars) |
| TD-08 | Cross-layer | Streaming and Download Delivery (Range/206) | API streaming proxy with validated Range | A (API streaming proxy) |
| TD-09 | Backend | Video Status State Machine and Failure Recovery | Transition table + compare-and-set + reprocess | A (transition table + CAS) |
| TD-10 | Cross-layer | Upload Limits, Validation and Abuse Controls | 3-layer verification + skip throttle on playback | A (3-layer validation) |
| TD-11 | Cross-layer | Video Access Authorization | Public ready-by-publicId, owner-only management | A (public ready / owner management) |

## Sources (official)

- BullMQ guide (retries, backoff, `jobId`, deduplication, stalled jobs, graceful shutdown, NestJS module) — `github.com/taskforcesh/bullmq/docs/gitbook` via Context7 `/taskforcesh/bullmq`.
- NestJS docs (queues, `StreamableFile`, standalone applications, health checks) — Context7 `/nestjs/docs.nestjs.com`.
- AWS SDK for JavaScript v3 (`CreateMultipartUpload`, `UploadPart`, `ListParts`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `HeadObject`, `GetObject` Range, `getSignedUrl`) — Context7 `/aws/aws-sdk-js-v3`.
- Amazon S3 multipart upload limits — https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html (10,000 parts; 5 MiB–5 GiB part size; last part unbounded below).
- MinIO thresholds — https://docs.min.io/enterprise/aistor-object-store/reference/aistor-server/thresholds/ (10,000 parts; optimal part size 64–512 MiB); `mc mb`, `mc ilm` — Context7 `/minio/mc`, `/minio/docs`.
- FFmpeg/ffprobe documentation (`-show_format -show_streams -of json`, single-frame extraction) — Context7 `/websites/ffmpeg_documentation`.
- RFC 9110 §14 (Range requests, `206 Partial Content`, `416 Range Not Satisfiable`) — https://www.rfc-editor.org/rfc/rfc9110#section-14.
