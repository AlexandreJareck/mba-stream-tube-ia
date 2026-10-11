---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-09-24T00:15:00-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-11T18:27:05-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-11T16:50:27-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-11T16:50:27-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-11T16:50:27-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-11T16:50:27-03:00"
  docs/phase-03-handoff/specification.md: "2026-10-11T16:50:27-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-09-24T00:15:00-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-11T18:28:17-03:00"
---

# phase-03-videos — Context

> _Execution note:_ the plan-pipeline skills are `disable-model-invocation: true`; this artifact was produced by the agent executing `plan-context/SKILL.md` step by step. The reading sub-agents (`plan-reader`, `decisions-reader`, `decisions-detail-reader`, `decisions-correlator`, `phases-reader`) were **not** dispatched — their outputs were reproduced from bounded direct reads of the same sources listed in `sources_mtime`. Correlated-doc confirmation (Step 4): the user asked for the agent's recommendation; only `openapi-docs-nestjs` (ranked high) was included.

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** frontend upload/player/management UI; social features, search, comments, likes, subscriptions; adaptive transcoding/HLS; cloud deployment/real S3; rewriting auth, users or channels (`docs/phase-03-handoff/specification.md` §12). Video visibility (public/unlisted), categories, editing and publication flow belong to Fase 04.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — video UI explicitly out of scope (`specification.md` §2, §12).

**Sequencing notes:** Depende de: Fase 01, Fase 02. Execution contract and acceptance criteria: `docs/phase-03-handoff/specification.md` (precedence §3: specification → CLAUDE.md/rules/skills → project-plan → architecture diagram → Phase 01/02 patterns → official docs → Phase 03 decisions).

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta — provides users, channels (one per user), global JWT guard, domain exceptions, throttler.
- **Phase 04:** Gerenciamento de Vídeos e Canal — categories, editing, visibility public/unlisted, draft → publication, channel panel.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Processing Queue Technology and NestJS Integration | decided | A (BullMQ + Redis via `@nestjs/bullmq`) | `bullmq@^6.3.x`, `@nestjs/bullmq@^12.0.x`, `ioredis` (transitive via bullmq) |
| phase-03-videos/TD-02 | phase | Cross-layer | Direct Upload Protocol for Files up to 10 GB | decided | A (S3 multipart upload with presigned `UploadPart` URLs) | `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x` |
| phase-03-videos/TD-03 | phase | Backend | Bucket Layout, Object Keys, Lifecycle and Access Policy | decided | A (Single private bucket, prefix-per-video keys, app-level cleanup) | `@aws-sdk/client-s3@^3.x` |
| phase-03-videos/TD-04 | phase | Backend | Worker Execution Model and FFmpeg/ffprobe Usage | decided | A (NestJS standalone worker + direct `ffprobe`/`ffmpeg` via `child_process`) | — |
| phase-03-videos/TD-05 | phase | Backend | Processing Message Format, Versioning and Delivery Guarantees | decided | A (`video.process` v1 claim-check `{ version: 1, videoId }`, at-least-once) | `bullmq@^6.3.x` |
| phase-03-videos/TD-06 | phase | Backend | Idempotency, Retries, Backoff and Permanently Failed Jobs | decided | A (Deterministic `jobId` + compare-and-set updates + retained failed set) | `bullmq@^6.3.x` |
| phase-03-videos/TD-07 | phase | Cross-layer | Unique Public Video Identifier | decided | A (11-char base64url from `crypto.randomBytes(8)` + unique index + retry) | — |
| phase-03-videos/TD-08 | phase | Cross-layer | Streaming and Download Delivery (Range/206) | decided | A (API streaming proxy with validated Range) | `@aws-sdk/client-s3@^3.x` |
| phase-03-videos/TD-09 | phase | Backend | Video Status State Machine and Failure Recovery | decided | A (Explicit transition table + compare-and-set updates, reprocess from `failed`) | — |
| phase-03-videos/TD-10 | phase | Cross-layer | Upload Limits, Validation and Abuse Controls | decided | A (Declared metadata + completion verification + ffprobe validation; per-route throttling) | `@nestjs/throttler@^6.x` (inherited) |
| phase-03-videos/TD-11 | phase | Cross-layer | Video Access Authorization | decided | A (Public read of `ready` videos by public id; owner-only management by internal id) | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-05, phase-03-videos/TD-06 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-06, phase-03-videos/TD-10 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-09 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-09 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-07, phase-03-videos/TD-11 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-08, phase-03-videos/TD-11 |
| Download do vídeo pelo usuário | phase-03-videos/TD-08, phase-03-videos/TD-11 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ + Redis via `@nestjs/bullmq` — it is the queue the project's own best-practices skill prescribes, has first-class Nest 11 support and covers retries, deduplication by `jobId`, stalled-job recovery and failed-job retention natively; the non-atomic enqueue is closed by the idempotent completion/re-publish design in TD-06.

**Libraries:** `bullmq@^6.3.x`, `@nestjs/bullmq@^12.0.x`, `ioredis` (transitive via bullmq)

### phase-03-videos/TD-02

**Recommendation:** S3 multipart with presigned part URLs — the only option that keeps the API out of the data path while supporting >5 GiB and resume; contract parameters: part size 64 MiB (MinIO's documented optimal range 64–512 MiB, S3-valid), part URLs valid 1 h and re-signable, upload session valid 24 h, completion verified with `ListParts` + `HeadObject` size equality.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-03

**Recommendation:** single private bucket, prefix-per-video, app-level cleanup — minimal provisioning, no 10 GB copies, deterministic keys for idempotency, and abandoned uploads become a visible state transition instead of silent storage garbage.

**Libraries:** `@aws-sdk/client-s3@^3.x`

### phase-03-videos/TD-04

**Recommendation:** Nest standalone worker + direct `ffprobe`/`ffmpeg` — separate container as required while reusing the project's modules; streaming the input over a presigned internal URL avoids both full downloads and in-memory buffering of up to 10 GB.

**Note:** `ffmpeg`/`ffprobe` are OS binaries installed in the worker image (Debian `ffmpeg` package), not npm libraries.

**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** `video.process` v1 `{ version: 1, videoId }`, at-least-once — BullMQ delivers at-least-once (stalled jobs are re-run), so the consumer must be idempotent anyway; reading the row keeps the DB authoritative and the contract small.

**Libraries:** `bullmq@^6.3.x`

### phase-03-videos/TD-06

**Recommendation:** deterministic `jobId` + conditional updates + retained failed set — gives the required idempotency for double completion, redelivery and worker restarts with native primitives; the non-atomic gap is closed by the idempotent re-publish on repeated completion and by reprocess.

**Libraries:** `bullmq@^6.3.x`

### phase-03-videos/TD-07

**Recommendation:** crypto base64url, 11 chars, unique index + retry — short, unguessable and dependency-free, reusing the project's existing unique-violation retry pattern.

**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** API streaming proxy with validated Range — it is the only option where the API itself guarantees the required Range/206 contract and authorization while keeping storage private; bandwidth is the accepted trade-off for this phase and Option B remains a drop-in optimization behind the same routes.

**Note:** Resolves `phase-03-videos` IC-1 — deliberate deviation from `docs/diagrams/software-arch.mermaid` (`frontend → storage "Streams"`) for Phase 03; the specification (§3 rank 1) requires the API to guarantee Range/206 and authorization. Option B (presigned redirect) stays a drop-in optimization behind the same routes.

**Libraries:** `@aws-sdk/client-s3@^3.x`

### phase-03-videos/TD-09

**Recommendation:** transition table + compare-and-set updates, reprocess from `failed` — minimal, race-free and directly testable; reprocess gives a recovery path for transient permanent failures.

**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** declared metadata + completion verification + ffprobe validation; skip throttling on playback routes — enforces the 10 GiB bound in all three layers without reading video bytes in the API and keeps the inherited throttler from breaking Range playback.

**Note:** Resolves `phase-03-videos` AMB-1 — limit is **10 GiB = 10,737,418,240 bytes, inclusive** (superset of decimal 10 GB). Resolves ICC-1 — the inherited global `ThrottlerGuard` stays; video lookup/stream/download routes use `@SkipThrottle()`, upload-management routes keep the global default.

**Libraries:** `@nestjs/throttler@^6.x` (inherited)

### phase-03-videos/TD-11

**Recommendation:** public read of ready videos, owner-only management by UUID — honors anonymous viewing, keeps non-ready videos private, and requires no changes to the inherited global guard; Phase 04 layers visibility on top.

**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** @nestjs/config — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Joi — First-class integration with `@nestjs/config` via `validationSchema`, zero custom wiring, native string-to-number coercion.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Namespaced/grouped with registerAs — clear file boundaries per domain (the plan explicitly anticipates storage config), typed injection via `ConfigType<typeof xxxConfig>`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Shared registerAs factory — `data-source.ts` imports the factory, loads `.env`, calls the factory.

**Libraries:** `dotenv` (transitive)

### phase-02-auth/TD-02

**Recommendation:** Custom guards with `@nestjs/jwt` only (decision diverged from the Passport recommendation) — global `JwtAuthGuard` as `APP_GUARD`, `@Public()` opt-out, `@CurrentUser()` exposes `{ sub, email }`.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-06

**Recommendation:** class-validator + class-transformer — documented NestJS approach; global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Custom Domain Exception Filter — services throw `DomainException(errorCode, httpStatus, message)`; filter renders `{ statusCode, error, message }`.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** @nestjs/throttler — `ThrottlerGuard` registered as `APP_GUARD` (global, `ttl 60000`, `limit 10`), `@SkipThrottle()` / `@Throttle()` for per-route overrides.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-10

**Recommendation:** `[a-z0-9_]` nickname allowlist with random-suffix retry on unique violation (`ChannelsService`) — reusable pattern for collision-free identifiers.

**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** `@nestjs/swagger` + CLI plugin (`classValidatorShim: true`, `introspectComments: true`) — schemas inferred from class-validator DTOs; controllers declare `@ApiTags`, `@ApiOperation`, `@ApiResponse` per status.

**Libraries:** `@nestjs/swagger`

### openapi-docs-nestjs/TD-02

**Recommendation:** Runtime Swagger UI + exported `openapi.json` (`npm run openapi:export`) — the committed spec is the FE contract and must be regenerated when routes change.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Swagger UI only in dev/staging via `SWAGGER_ENABLED`.

**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables validated by the Joi schema in `src/config/env.validation.ts` (`allowUnknown: true, abortEarly: false`); new keys must also be documented in `.env.example`. _(from phase 01)_
- Config injected via `ConfigType<typeof xxxConfig>` + `@Inject(xxxConfig.KEY)`; factories importable as plain functions outside DI. _(from phase 01)_
- `TypeOrmModule.forRootAsync` with `autoLoadEntities: true`, `synchronize: false`; schema changes only through versioned migrations in `src/database/migrations/`. _(from phase 01)_
- Every endpoint is protected by the global `JwtAuthGuard`; public routes opt out with `@Public()`; user identity comes from `@CurrentUser()` (`JwtPayload { sub, email }`). _(from phase 02)_
- Services throw `DomainException` subclasses (in `src/common/exceptions/domain.exception.ts`), never Nest HTTP exceptions; error body `{ statusCode, error, message }`. _(from phase 02)_
- Each user owns exactly one channel (`channels.user_id` unique); channel resolution by user id goes through `ChannelsModule`. _(from phase 02)_
- Unique-violation retry pattern: detect PG `23505` on the target column and regenerate (`ChannelsService`). _(from phase 02)_
- Tests: `*.spec.ts` unit (mocks only), `*.integration-spec.ts` real DB/services next to source, `*.e2e-spec.ts` under `test/` with supertest; integration/e2e run `--runInBand`; e2e reproduces `main.ts` globals manually and clears throttler storage in `beforeEach`. _(from phase 02)_
- All `npm`/`npx`/test commands run inside the `nestjs-api` container; inter-container hosts use Compose service names. _(from phase 02 / nestjs-project/CLAUDE.md)_
- Every controller method carries `@ApiTags`, `@ApiOperation`, `@ApiResponse` per status (errors via `getSchemaPath(ApiErrorEnvelope)`), `@ApiBearerAuth('access-token')` on protected routes; `openapi.json` is regenerated after route changes. _(from openapi-docs-nestjs)_
- Plans: Portuguese prose, English identifiers; per-TD traceability via backticked refs. _(from phase 02)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred (backend phase-02-auth) — partially delivered by phase-02-auth-frontend | phase-02-auth | `next-frontend/` was not initialized when the backend slice ran. |

## UI Inventory

_No screen inventory — UI↔API sync deferred. Run /screen-inventory 03 and then rerun /plan-context 03 to activate UI checks._

> Step 0.5 note: the UI signal fired only through the substring heuristic (`UI` inside "arq**ui**vos"); no capability describes a screen. Option (b) "deferred" was applied because `docs/phase-03-handoff/specification.md` §2/§12 already declares all video UI out of scope.

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only | Integration: DB contract |
| Service with configured lib | Unit: real lib with test config |
| Service with side-effect dep (email, storage, queue) | Integration: real external service (MinIO, Redis/BullMQ, FFmpeg) |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only |
| DTO | E2E: one validation wiring test per endpoint |
| Guard | E2E + Unit if complex internal logic |
| Pipe / pure utility | Unit |

Additional phase requirements (`specification.md` §10): unit tests for state transitions, identifier/key generation, validation, Range parsing, idempotency and failure handling; integration with real PostgreSQL, MinIO, queue and FFmpeg (small fixture); e2e for auth, upload start/completion, processing to `ready`, thumbnail, unique-URL lookup, partial streaming, download and primary authorization/error cases; no 10 GB file in the suite plus a reproducible 10 GB-boundary acceptance procedure.
