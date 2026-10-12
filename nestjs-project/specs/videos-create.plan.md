---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: nestjs-project/test/videos-create.e2e-spec.ts
---

# POST /channels/me/videos Test Plan

## Application Overview

Starts a direct-to-storage multipart upload: the authenticated user's channel gets a new video in `draft` and the response carries presigned `UploadPart` URLs. The API never receives the file bytes.

## Test Scenarios

### 1. Start upload

**Setup:** `beforeEach` cleans tables (including `videos`) and throttler storage; app bootstrapped from `AppModule` with `main.ts` globals; a confirmed user is registered and logged in.

#### 1.1. creates-draft-with-presigned-parts

**Covers AC:** #1, #5
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. POST /channels/me/videos with Bearer token and body { title, filename: "clip.mp4", content_type: "video/mp4", size_bytes: 3145728 }
    - expect: 201 with status "draft" and public_id matching /^[A-Za-z0-9_-]{11}$/
    - expect: upload.part_count = 1 and upload.parts has 1 entry whose URL contains "partNumber=1"
  2. Query the videos table by the returned id
    - expect: status = 'draft', upload_id not null, channel_id = the user's channel id

#### 1.2. accepts-10gib-boundary-rejects-above

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. POST /channels/me/videos with size_bytes = 10737418240
    - expect: 201 and upload.part_count = 160
  2. POST /channels/me/videos with size_bytes = 10737418241
    - expect: 400 with error "VALIDATION_ERROR"

#### 1.3. rejects-non-video-content-type

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. POST /channels/me/videos with content_type "image/png"
    - expect: 400 with error "VALIDATION_ERROR"

#### 1.4. requires-authentication

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. POST /channels/me/videos without Authorization header
    - expect: 401
