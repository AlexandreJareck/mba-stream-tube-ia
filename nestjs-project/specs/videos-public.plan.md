---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.14
target_file: nestjs-project/test/videos-public.e2e-spec.ts
---

# Public lookup and thumbnail Test Plan

## Application Overview

Anyone can resolve a `ready` video by its unique public id and fetch its thumbnail from the private bucket through the API. Videos that are not `ready` are indistinguishable from missing ones.

## Test Scenarios

### 1. Lookup and thumbnail

**Setup:** `beforeEach` cleans tables; a ready video is seeded (row with status 'ready' plus a JPEG thumbnail object in MinIO); a draft video is created through the API.

#### 1.1. anonymous-reads-ready-video

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /videos/{publicId} without Authorization
    - expect: 200 with title, duration_seconds and stream_url "/videos/{publicId}/stream"

#### 1.2. non-ready-is-404

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /videos/{draftPublicId}
    - expect: 404 with error "VIDEO_NOT_FOUND"

#### 1.3. thumbnail-is-served-as-jpeg

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /videos/{publicId}/thumbnail
    - expect: 200, content-type image/jpeg, body starting with bytes FF D8 FF

#### 1.4. malformed-public-id-is-404

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /videos/abc
    - expect: 404 with error "VIDEO_NOT_FOUND"
