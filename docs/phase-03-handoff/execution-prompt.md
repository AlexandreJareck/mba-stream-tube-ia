# Execution Prompt — StreamTube Phase 03

You are the agent responsible for fully planning and implementing Phase 03 — Video Upload and Processing — in this repository.

First, read all of the following in full:

- `docs/phase-03-handoff/specification.md`;
- `CLAUDE.md`;
- `docs/project-plan.md`;
- `docs/diagrams/software-arch.mermaid`;
- the artifacts in `docs/phases/phase-02-auth/`;
- the existing decision documents;
- the skills, rules, and agent definitions in `.claude/`;
- `nestjs-project/CLAUDE.md`.

Your execution must strictly follow the instructions below.

## Working rules

1. Do not implement directly on `main`. Update `dev` and create a `feature/phase-03-videos` branch from it.
2. Preserve the user's pre-existing changes. Before editing, inspect the branch, remotes, and working tree.
3. If you are using OpenAI Codex, port the project's AI foundation before planning:
   - translate the relevant instructions from `CLAUDE.md` into a compatible `AGENTS.md`, without removing `CLAUDE.md`;
   - map the workflow skills/rules to equivalent Codex skills or instructions; when no equivalent exists, perform the same stage manually;
   - configure or document equivalent MCPs for PostgreSQL and Context7;
   - clearly record the mapping performed. Do not claim that a skill was executed if the mechanism did not exist; manually produce the contracted artifact.
4. Use AI as the primary production tool and keep its participation observable in the decision, planning, and progress artifacts. Critically review every output and refine the instruction/prompt when it is shallow, inconsistent, or lacks traceability.
5. Every decision, contract, or behavior must be traceable to the assignment, existing code, official documentation, or a recorded decision.
6. Before using new libraries, identify compatible versions and consult the official documentation through Context7. Record the references in `library-refs.md`.
7. Reuse the patterns from Phases 01 and 02. Do not rewrite auth, users, or channels.
8. All communication between containers must use the Compose service name; never use `localhost` internally.
9. Respect the established layer separation, repository pattern, events/queue usage, and transaction boundaries. Use `auth/` as a structural reference without blindly copying its structure.
10. Do not directly invoke the reading sub-agents in `.claude/agents/`; they are internal dependencies of the skills. If you are using another tool, reproduce the stage results without pretending that those sub-agents were executed.
11. Extend the existing NestJS 11 + TypeORM + PostgreSQL 17 backend. Preserve the global JWT guard, domain exception filters, global `ValidationPipe`, rate-limiting conventions, versioned migrations, seeds, and Swagger/OpenAPI setup. Do not enable TypeORM schema synchronization.

## Mandatory order

### Stage 0 — Baseline

- Inspect the repository and its local instructions.
- Start the current backend with Docker Compose, install dependencies, and run migrations.
- Run the existing test suite, typecheck, and lint.
- Record pre-existing failures separately; do not hide them or mix out-of-scope fixes into this work.

### Stage 1 — Research

Research the open decisions required by `docs/phase-03-handoff/specification.md`, especially the queue, multipart presigned upload, worker/FFmpeg, messages/idempotency, Range/206 streaming, unique URL, and status lifecycle.

Produce `docs/decisions/technical-decisions-phase-03-videos.md` using the format already established in the project. For every decision, present the options, trade-offs, recommendation, consequences, libraries, and official sources.

S3-compatible storage with MinIO is a given constraint, not an open decision.

Stop and critically review the document before moving forward. Do not implement anything during this stage.

### Stage 2 — Planning pipeline

Execute in this order:

1. `plan-context` → `docs/phases/phase-03-videos/context.md`;
2. `plan-validate` → `validation.md`;
3. `plan-resolve` → resolve every pending issue, update the decisions/context, and produce `library-refs.md`;
4. repeat `plan-validate ↔ plan-resolve` until `validation.md` ends with `status: clean` and zero issues;
5. `plan-build` → `phase-03-videos.md`;
6. generate test specifications if the corresponding skill is available.

The final plan must contain `SI-03.x` SIs, Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages, Dependency Map, Deliverables, tests, and acceptance criteria. Include the Swagger/OpenAPI contract update in the applicable SIs. Validate traceability against every requirement in the specification.

You must not begin implementation while `validation.md` is dirty, a decision remains open, or a contract is ambiguous.

### Stage 3 — SI-by-SI implementation

- Follow the Dependency Map order.
- Before each SI, confirm its dependencies and acceptance criteria.
- Implement only that SI's scope.
- Run the relevant tests, typecheck, and lint in proportion to the change.
- Fix the cause of every failure before moving forward.
- Update `docs/phases/phase-03-videos/progress.md` with real status, files, tests, and evidence.
- Make small, descriptive commits that follow Git Flow.

You must implement the videos module, migration, S3/MinIO integration, automatic video pre-registration in `draft` when upload starts, direct multipart/presigned upload, idempotent completion, a real queue, a separate FFmpeg/ffprobe worker, thumbnail generation, metadata extraction, unique URL, Range/206 streaming, download, the state machine, Swagger/OpenAPI contracts, Docker Compose infrastructure, and tests.

Do not pass the file of up to 10 GB through the API, and do not load the full video into memory.

### Stage 4 — Completion

- Start the full stack in a clean environment and run migrations.
- Run `npm test`, `npm run test:e2e`, `npx tsc --noEmit`, and `npm run lint`.
- Exercise the real MinIO, queue, and worker with a small fixture.
- Record a reproducible acceptance procedure showing that the production multipart contracts and storage limits accept the 10 GB boundary without proxying the file through the API. A generated/sparse object may be used when a real 10 GB transfer is impractical, but configuration alone is not sufficient evidence.
- Review every criterion in `docs/phase-03-handoff/specification.md` one by one.
- Update the root `CLAUDE.md`, `nestjs-project/CLAUDE.md`, and `AGENTS.md`/equivalents only with endpoints, events, services, and behaviors that actually exist.
- Verify that documentation, plan, progress, code, and tests are consistent.

## Blocking policy

If you find a decision that materially changes the product and cannot be resolved from the sources or research, record the question and ask for guidance. Do not choose silently.

If Docker, official documentation, or external infrastructure is unavailable, exhaust safe diagnostics, record the evidence, and report the limitation. Do not mark the phase complete while the Definition of Done has not passed.

## Final report format

Report objectively:

1. branch and commits;
2. main technical decisions;
3. artifacts created/updated;
4. completed SIs;
5. endpoints, events, and services added;
6. migration and data model;
7. exact results for tests, e2e, typecheck, and lint;
8. how to reproduce the upload/processing/streaming/download flow;
9. real limitations or pending items.

Do not present partial completion as full success.
