# Execution Specification — Phase 03: Video Upload and Processing

## 1. Purpose of this document

This document turns the assignment into a verifiable work contract for the agent that will plan and implement StreamTube Phase 03.

It does not replace the repository's planning pipeline. Final technical decisions, exact contracts, and Step Implementations (SIs) must be produced through `research → plan-context → plan-validate ↔ plan-resolve → plan-build → implement`.

## 2. Expected outcome

Deliver the complete StreamTube Phase 03 backend in this public fork:

- video uploads of up to 10 GB without routing the full file through the API;
- automatic video pre-registration as a draft when upload begins;
- S3-compatible storage, using MinIO locally;
- a processing queue and worker running in a separate container;
- automatic duration and metadata extraction with `ffprobe`/FFmpeg;
- automatic thumbnail generation from a video frame;
- a collision-free unique public identifier per video;
- playback with HTTP Range support and `206 Partial Content` responses;
- video download;
- persisted `draft → processing → ready | failed` lifecycle;
- a videos-table migration linked to channels;
- full infrastructure running through Docker Compose;
- appropriate unit, integration, and e2e tests;
- phase documentation and agent instructions consistent with the final code.

The frontend exists, but all video UI work is out of scope.

## 3. Sources of truth and precedence

The agent must reconcile these sources before deciding or implementing:

1. the acceptance criteria in this specification and the assignment;
2. repository `CLAUDE.md`, rules, and skills;
3. the Phase 03 section of `docs/project-plan.md`;
4. `docs/diagrams/software-arch.mermaid`;
5. patterns implemented in Phases 01 and 02;
6. official documentation for the actual installed versions, consulted through Context7;
7. Phase 03 decision and planning documents.

Conflicts or gaps must be recorded and resolved during `plan-validate`/`plan-resolve`. Do not invent requirements, contracts, or behaviors without recording their source or decision.

Additional safeguards in this document—such as idempotency, multipart cleanup, health checks, and observability—are derived engineering requirements that make the original criteria verifiable and operable. Their exact implementation remains a research/planning decision.

## 4. Mandatory functional scope

### 4.1 Starting an upload

- Require authentication through the existing global JWT guard.
- Resolve the authenticated user's channel and create a video owned by that channel.
- Create the initial record in `draft` status.
- Receive the minimum metadata defined by the plan, including at least the title and data needed to validate type/size.
- Generate the storage key and unique public identifier.
- Return a direct-to-object-storage upload strategy, preferably multipart with presigned URLs, compatible with files up to 10 GB.
- The API must not keep the full binary body in memory or proxy the 10 GB file.

### 4.2 Completing an upload

- Verify that the expected upload exists and is complete in storage.
- Make completion idempotent: safe repetition must not create duplicate jobs or corrupt state.
- Move the video from `draft` to `processing` and publish the processing message.
- Define how abandoned uploads, orphaned multipart parts, and expired URLs are handled.

### 4.3 Asynchronous processing

- Run in a process/container separate from the API.
- Consume the real queue selected during research.
- Download or access the input object in a controlled manner without loading it fully into memory.
- Extract duration and metadata with `ffprobe`/FFmpeg.
- Generate a deterministic thumbnail and store it in object storage.
- Persist duration, metadata, thumbnail key, and final `ready` status.
- On failure, persist `failed` plus sufficient operational information without exposing internal details through the API.
- Define retries, backoff, idempotency, deduplication, and the destination of permanently failed jobs.

### 4.4 Video access

- Provide lookup by unique public identifier.
- Streaming must honor `Range`, validate ranges, and return correct HTTP headers/status codes, including `206`.
- Download must use attachment semantics and follow the authorization matrix defined in the plan.
- Document endpoints and schemas through the backend's established Swagger/OpenAPI mechanism.
- Explicitly decide whether the API redirects/signs URLs or proxies streams, justifying security, performance, and S3/MinIO compatibility.
- Videos not in `ready` status must not be served as ready.

## 5. Persistence requirements

The exact model is finalized in the plan, but the `videos` entity/table must contain at least:

- an internal UUID;
- a foreign key and domain relation to `channels`;
- title;
- persisted status (`draft`, `processing`, `ready`, `failed`, or justified equivalents);
- a unique public identifier protected by a uniqueness constraint/index;
- video object key;
- nullable thumbnail key before processing;
- nullable duration before processing;
- nullable structured technical metadata before processing;
- timestamps;
- failure/reprocessing information deemed necessary by the plan.

The migration must create constraints, indexes, and the foreign key, and provide a safe rollback path.

## 6. Mandatory research decisions

Create `docs/decisions/technical-decisions-phase-03-videos.md` in the existing format, comparing options, trade-offs, recommendation, and consequences for:

1. queue technology and NestJS integration;
2. direct upload up to 10 GB: multipart, presigned URLs, expiry, part size, and completion;
3. MinIO/S3 buckets, keys, lifecycle, and access policy;
4. worker execution and FFmpeg/ffprobe usage;
5. message format/versioning and delivery guarantees;
6. idempotency, retries, backoff, and permanently failed jobs;
7. unique public identifier;
8. streaming and download, including Range/206;
9. state machine and failure recovery;
10. upload limits, validation, and security.

S3-compatible storage is a given constraint: MinIO in development and S3 in production. Do not reopen the object-storage type decision.

## 7. Mandatory pipeline artifacts

- `docs/decisions/technical-decisions-phase-03-videos.md`;
- `docs/phases/phase-03-videos/context.md`;
- `docs/phases/phase-03-videos/validation.md`, ending with `status: clean` and zero pending issues;
- `docs/phases/phase-03-videos/library-refs.md`, with installed versions and consulted official references;
- `docs/phases/phase-03-videos/phase-03-videos.md`;
- `docs/phases/phase-03-videos/progress.md`, updated for every SI;
- test specifications if the corresponding skill is used;
- `AGENTS.md` and other necessary adaptations when Codex is used;
- `CLAUDE.md` and/or its equivalent, updated only with behavior that actually exists.

The final plan must contain:

- SIs named `SI-03.1`, `SI-03.2`, ...;
- Data Model;
- complete API Contracts;
- Authorization Matrix;
- Error Catalog;
- queue Events/Messages, including payload, version, producer, consumer, idempotency, and failures;
- SI Dependency Map;
- Deliverables and acceptance criteria per SI;
- testing strategy per SI;
- traceability across requirements, decisions, SIs, code, and tests.

Skills may internally use the reading sub-agents in `.claude/agents/`. The executor must not invoke them directly or bypass the skill sequence.

## 8. Contracts the plan must finalize

Before implementation, the plan must unambiguously define:

- routes, methods, DTOs, HTTP codes, and response examples;
- Swagger decorators/schemas needed to keep OpenAPI aligned with the routes;
- user/channel identity extracted from JWT;
- who may start, complete, view, stream, download, and reprocess a video;
- behavior for missing video, unauthorized access, invalid status, expired upload, missing object, invalid range, and queue/storage failure;
- valid and invalid state transitions;
- transaction boundaries across database, storage, and queue;
- protection against double completion, duplicate messages, and worker restarts;
- configuration and health checks for new services;
- size/MIME limits and validation in storage, API, and worker;
- cleanup of temporary artifacts and abandoned uploads;
- minimum observability with video/job-correlated logs and no sensitive data.

## 9. Expected infrastructure

In addition to current services, `nestjs-project/compose.yaml` must start:

- MinIO object storage and bucket initialization when required;
- the selected queue technology and its dependencies;
- the FFmpeg/ffprobe video worker;
- coherent health checks and startup dependencies.

Container-to-container communication must use Compose service names, never `localhost`.

Secrets and configuration must be documented in `.env.example`; no real secrets may be committed.

## 10. Minimum testing strategy

- Unit: state transitions, identifier/key generation, validation, Range parsing, idempotency, and failure handling.
- Integration: repositories/migration with real PostgreSQL; real MinIO storage; real queue publication/consumption; a small fixture processed with real FFmpeg.
- E2E: authentication, upload start/completion, processing through `ready`, thumbnail, unique-URL lookup, partial streaming, download, and primary authorization/error cases.
- Do not place a 10 GB file in the suite. Demonstrate architectural support for the limit through configuration, validation, and multipart; use small fixtures for reproducibility.
- Do not mock the database, queue, storage, or FFmpeg where the requirement calls for real integration and Compose provides it.

Conventions: `*.spec.ts`, `*.integration-spec.ts`, and `*.e2e-spec.ts`.

## 11. Definition of Done

Implementation may be declared complete only with evidence that:

- all functional criteria are met;
- `validation.md` was clean before implementation began;
- every SI is implemented and recorded in `progress.md`;
- relevant tests are green for every SI;
- the full suite is green (`npm test` and `npm run test:e2e`);
- `npx tsc --noEmit` exits with code 0;
- `npm run lint` passes;
- the Compose stack is healthy with API, PostgreSQL, Mailpit, storage, queue, and worker;
- migrations run in a clean environment;
- documentation and instruction files match the code, including root `CLAUDE.md` and `nestjs-project/CLAUDE.md` (or tool equivalents) when both exist;
- a `feature/*` branch was created from `dev`, with no direct commit to `main`;
- this specification and the assignment were reviewed item by item.

## 12. Out of scope

- frontend upload, player, or video-management UI;
- social features, search, comments, likes, and subscriptions;
- adaptive transcoding/HLS unless a technical decision proves it indispensable (it is not an original requirement);
- cloud deployment or real S3 usage;
- rewriting auth, users, or channels.

## 13. Delivery evidence

The executor's final handoff must list:

- branch and commits;
- decisions made and links to artifacts;
- completed SIs;
- implemented routes and events;
- added Compose services;
- created migrations;
- validation commands and their results;
- actual limitations, without claiming success if any Definition of Done item fails.

## 14. Assignment coverage matrix

| Assignment requirement | Coverage in this specification | Expected final evidence |
|---|---|---|
| Backend-only challenge | Sections 2 and 12 | API, worker, and infrastructure; no video UI |
| Public fork continuing Phases 01–02 | Sections 2, 3, and 11 | Preserved history and `feature/*` branch from `dev` |
| AI-first, observable workflow | Sections 3, 7, and 13 | Versioned decisions, context, validation, plan, and progress |
| Porting when not using Claude Code | Section 7 | Ported/documented `AGENTS.md`/equivalent, skills, and MCPs |
| Research before planning | Section 6 | `technical-decisions-phase-03-videos.md` |
| context → validate ↔ resolve → build → implement | Sections 1 and 7 | Artifacts in order; clean `validation.md` |
| Plan with SIs and Technical Specifications | Section 7 | Complete `phase-03-videos.md` |
| S3/MinIO object storage | Sections 2, 6, and 9 | Real MinIO in Compose and tested integration |
| Separate queue and worker | Sections 2, 4.3, 6, and 9 | Real broker and worker in Compose |
| Direct upload up to 10 GB and automatic draft | Section 4.1 | Multipart/presigned flow and `draft` record |
| Processing, metadata, and thumbnail | Section 4.3 | FFmpeg/ffprobe worker and thumbnail object |
| Collision-free unique URL | Sections 4.1 and 5 | Unique constraint and collision tests |
| Streaming without full download | Section 4.4 | Valid Range returning `206` and correct headers |
| Download | Section 4.4 | Download contract and e2e test |
| Draft → processing → ready/error status | Sections 2, 4, and 5 | Persisted and tested transitions |
| Video linked to channel and migration | Sections 4.1 and 5 | FK, entity, and reversible migration |
| Repository pattern, layers, events, transactions | Sections 3 and 8 | Structure aligned with existing patterns and traceable plan |
| Real infrastructure exercised by tests | Sections 9 and 10 | Real PostgreSQL, MinIO, queue, and FFmpeg integration |
| Green tests, typecheck, and lint | Sections 10 and 11 | Outputs from `npm test`, `test:e2e`, `tsc`, and `lint` |
| Consistent CLAUDE.md/equivalent | Sections 7 and 11 | Root/backend instructions updated after the code |
