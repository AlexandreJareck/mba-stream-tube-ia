# phase-03-videos — Acceptance: 10 GiB upload boundary without proxying through the API

Requirement: `docs/phase-03-handoff/specification.md` §10 / §11 — prove that the production multipart contracts and storage limits accept a video at the 10 GB boundary without the file passing through the API. Limit fixed by `phase-03-videos/TD-10` (AMB-1): **10 GiB = 10,737,418,240 bytes, inclusive**.

## What the procedure exercises (all production code paths)

| Step | Path exercised | Real component |
|---|---|---|
| Register / login | `POST /auth/register`, `POST /auth/login` | API (AppModule, global JWT guard) |
| Size boundary | `POST /channels/me/videos` with 10737418241 → 400, with 10737418240 → 201 | `CreateVideoDto` validation, `VideosService.startUpload`, `planParts` (160 × 64 MiB) |
| Direct client upload | `PUT` of part 1 (64 MiB) to its presigned `UploadPart` URL | MinIO (S3 SigV4 presigned URL) — the API is not involved |
| Remaining bytes | parts 2–160 via S3 `UploadPartCopy` into the **same** `UploadId` (server-side copy of a 64 MiB chunk) | MinIO multipart upload created by the API |
| Resume contract | `GET /channels/me/videos/{id}/upload` → 160 uploaded parts, 0 missing | `ListParts` (paginated) + part size validation |
| Completion | `POST /channels/me/videos/{id}/upload/complete` → `processing` | `ListParts` verification, `CompleteMultipartUpload`, `HeadObject` size check, CAS `draft → processing`, BullMQ publish |
| No proxying | bytes received by the API process during the whole run | Express request listener on the real HTTP server |
| Worker | `worker` container processes the 10 GiB object by URL | ffprobe over presigned internal URL (Range reads, no download) |

Why `UploadPartCopy` for parts 2–160: pushing 10 GiB through the test client is impractical on the development machine; the specification allows a generated object as long as the same size validation, multipart initiation/completion contracts and storage constraints are used. Only the *source of the part bytes* differs from a real client — the multipart upload, its part numbering/size rules, the completion and the verification are the production ones. Part 1 proves the presigned client path for a full 64 MiB part.

## How to reproduce

Prerequisites: stack up (`docker compose up -d`), dependencies installed, migrations applied, ~10 GiB free in the `minio-data` volume.

```bash
cd nestjs-project
docker compose exec nestjs-api npx ts-node --transpile-only scripts/acceptance/ten-gib-boundary.ts
# add --keep to keep the assembled 10 GiB object in MinIO afterwards
```

The script boots the production `AppModule` in-process on an ephemeral port (no dev server needed), drives it over HTTP, asserts every step and ends with `RESULT PASS` (non-zero exit on any failed assertion). The source object is deleted at the end unless `--keep` is passed. The video row remains as `failed/INVALID_MEDIA` (the payload is random bytes, so the worker correctly rejects it as media).

## Evidence — run of 2026-10-12 (UTC), branch `feature/phase-03-videos`

```
[2026-10-12T00:56:21.237Z] user ready acceptance-42e0996c@example.com
[2026-10-12T00:56:21.242Z] 10737418241 bytes rejected {"status":400,"error":"VALIDATION_ERROR"}
[2026-10-12T00:56:21.311Z] 10737418240 bytes accepted {"videoId":"bb880ea0-34d4-4669-8801-f7c4df9c7e1a","status":"draft","part_count":160,"part_size":67108864,"presigned_urls":160}
[2026-10-12T00:56:21.593Z] part 1 (64 MiB) uploaded through its presigned URL {"status":200}
[2026-10-12T00:56:27.891Z] parts copied up to 40/160 
[2026-10-12T00:56:36.104Z] parts copied up to 80/160 
[2026-10-12T00:56:44.761Z] parts copied up to 120/160 
[2026-10-12T00:56:54.642Z] parts copied up to 160/160 
[2026-10-12T00:56:54.642Z] parts 2..160 filled server-side {"seconds":33}
[2026-10-12T00:56:54.672Z] upload session complete {"uploaded_parts":160,"missing":0}
[2026-10-12T00:56:54.718Z] completed {"status":"processing","processing_run":1,"object_bytes":10737418240}
[2026-10-12T00:56:54.718Z] bytes received by the API during the whole procedure 344
[2026-10-12T00:56:56.722Z] worker outcome for the random 10 GiB payload {"status":"failed","failure_reason":"INVALID_MEDIA"}
[2026-10-12T00:56:56.722Z] RESULT PASS
[2026-10-12T00:56:56.727Z] cleanup deleted videos/bb880ea0-34d4-4669-8801-f7c4df9c7e1a/source
```

Observations:

- The API received **344 bytes** in total (JSON bodies of register, login and the two start requests); the 10,737,418,240-byte object was assembled entirely in MinIO.
- The assembled object (`HeadObject.ContentLength`) is exactly 10,737,418,240 bytes; 160 parts of 64 MiB is within the S3/MinIO limit of 10,000 parts.
- The worker reached a final state in ~2 s because ffprobe reads only the bytes it needs over HTTP Range from the presigned internal URL — the 10 GiB object is never downloaded nor loaded into memory.
