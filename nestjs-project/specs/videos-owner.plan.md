---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.13
target_file: nestjs-project/test/videos-owner.e2e-spec.ts
---

# Owner video read and reprocess Test Plan

## Application Overview

Owners poll `GET /channels/me/videos/{id}` in any status and recover failed videos with `POST /channels/me/videos/{id}/reprocess`, which starts a new processing run.

## Test Scenarios

### 1. Read and reprocess

**Setup:** `beforeEach` cleans tables, throttler storage and queue; two confirmed users; videos created through the API (start upload) and, where needed, adjusted directly in the DB with the source object put in MinIO.

#### 1.1. owner-reads-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /channels/me/videos/{id} as the owner right after starting the upload
    - expect: 200 with status "draft", has_thumbnail false, duration_seconds null

#### 1.2. other-user-gets-404

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /channels/me/videos/{id} as the second user
    - expect: 404 with error "VIDEO_NOT_FOUND"

#### 1.3. reprocess-failed-starts-new-run

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. Mark a video as failed (processing_run = 1) with its source object present, then POST …/reprocess
    - expect: 200 with status "processing" and processing_run 2
    - expect: the queue holds job "video-process-{id}-2"

#### 1.4. reprocess-non-failed-is-409

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. POST …/reprocess on a draft video
    - expect: 409 with error "INVALID_VIDEO_STATUS"
