---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.15
target_file: nestjs-project/test/videos-stream.e2e-spec.ts
---

# Streaming (Range/206) and download Test Plan

## Application Overview

`/videos/{publicId}/stream` and `/download` pipe the private object through the API, honoring a single `bytes=` Range (RFC 9110) without buffering; download adds attachment semantics.

## Test Scenarios

### 1. Range streaming and download

**Setup:** `beforeEach` cleans tables; a ready video is seeded whose source object (the 3 s fixture) is put in MinIO; a draft video is created through the API.

#### 1.1. partial-range-returns-206

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /videos/{publicId}/stream with Range: bytes=0-1023
    - expect: 206, Content-Range "bytes 0-1023/{size}", Content-Length 1024, Accept-Ranges bytes
    - expect: body equals the first 1024 bytes of the fixture

#### 1.2. no-range-returns-full-200

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /videos/{publicId}/stream without Range
    - expect: 200, Accept-Ranges bytes, Content-Length = size, content-type video/mp4

#### 1.3. unsatisfiable-range-returns-416

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /videos/{publicId}/stream with Range: bytes={size}-
    - expect: 416 with error "RANGE_NOT_SATISFIABLE" and Content-Range "bytes */{size}"

#### 1.4. download-is-attachment-and-intact

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /videos/{publicId}/download
    - expect: 200, Content-Disposition starting with "attachment;" and containing a filename
    - expect: SHA-256 of the body equals SHA-256 of the fixture

#### 1.5. non-ready-stream-and-download-404

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-11T21:40:00Z
**Steps:**
  1. GET /videos/{draftPublicId}/stream and /download
    - expect: 404 with error "VIDEO_NOT_FOUND" on both
