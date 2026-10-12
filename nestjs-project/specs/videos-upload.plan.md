---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.10
target_file: nestjs-project/test/videos-upload.e2e-spec.ts
---

# Upload session and completion Test Plan

## Application Overview

`GET /channels/me/videos/{id}/upload` lets the owner resume a multipart upload (lists uploaded parts, re-signs missing ones). `POST /channels/me/videos/{id}/upload/complete` verifies the parts in storage, assembles the object, moves the video to `processing` and publishes exactly one `video.process` job, idempotently.

## Test Scenarios

### 1. Resume and complete

**Setup:** `beforeEach` cleans tables, throttler storage and the `video-processing` queue; confirmed user logged in; a two-part upload is started with `size_bytes = 5 MiB + 1 KiB` and the part size configured to 5 MiB (`VIDEO_UPLOAD_PART_SIZE_BYTES`).

#### 1.1. resume-lists-uploaded-and-resigns-missing

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. PUT part 1 (5 MiB) directly to its presigned URL
  2. GET /channels/me/videos/{id}/upload
    - expect: 200, uploaded_parts = [{ part_number: 1, size: 5242880 }], parts contains only part_number 2

#### 1.2. complete-with-missing-part-is-rejected

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. POST …/upload/complete after uploading only part 1
    - expect: 409 with error "UPLOAD_INCOMPLETE"
    - expect: video status remains 'draft'

#### 1.3. complete-moves-to-processing-and-enqueues-once

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. PUT both parts, then POST …/upload/complete
    - expect: 200 with status "processing"
    - expect: the queue holds job "video-process-{id}-1" with data { version: 1, videoId, processingRun: 1 }
  2. POST …/upload/complete again
    - expect: 200 with the current status (processing or ready)
    - expect: still exactly one job for this video

#### 1.4. non-owner-gets-404

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. A second confirmed user calls GET …/upload and POST …/upload/complete on the first user's video
    - expect: 404 with error "VIDEO_NOT_FOUND" on both

#### 1.5. expired-session-returns-410

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. Set upload_expires_at in the past directly in the DB, then GET …/upload
    - expect: 410 with error "UPLOAD_EXPIRED"
