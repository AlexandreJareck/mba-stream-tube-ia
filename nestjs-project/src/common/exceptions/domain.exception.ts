export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Channel not found for the current user');
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class InvalidVideoStatusException extends DomainException {
  constructor(current: string, attempted?: string) {
    super(
      'INVALID_VIDEO_STATUS',
      409,
      attempted
        ? `Video in status '${current}' cannot move to '${attempted}'`
        : `Operation not allowed for a video in status '${current}'`,
    );
  }
}

export class UploadExpiredException extends DomainException {
  constructor() {
    super('UPLOAD_EXPIRED', 410, 'The upload session has expired');
  }
}

export class UploadIncompleteException extends DomainException {
  constructor(missingParts: number[]) {
    super(
      'UPLOAD_INCOMPLETE',
      409,
      `Upload is incomplete; missing or invalid parts: ${missingParts.join(', ')}`,
    );
  }
}

export class UploadSizeMismatchException extends DomainException {
  constructor() {
    super(
      'UPLOAD_SIZE_MISMATCH',
      422,
      'Uploaded object size does not match the declared size',
    );
  }
}

export class VideoSourceMissingException extends DomainException {
  constructor(httpStatus: 404 | 409 = 404) {
    super('VIDEO_SOURCE_MISSING', httpStatus, 'Video source file is missing');
  }
}

export class RangeNotSatisfiableException extends DomainException {
  constructor(public readonly sizeBytes: number) {
    super('RANGE_NOT_SATISFIABLE', 416, 'Requested range not satisfiable');
  }
}

export class StorageUnavailableException extends DomainException {
  constructor() {
    super('STORAGE_UNAVAILABLE', 503, 'Object storage is unavailable');
  }
}

export class QueueUnavailableException extends DomainException {
  constructor() {
    super('QUEUE_UNAVAILABLE', 503, 'Processing queue is unavailable');
  }
}

export class VideoTooLargeException extends DomainException {
  constructor(maxSizeBytes: number) {
    super(
      'VIDEO_TOO_LARGE',
      413,
      `Video exceeds the maximum allowed size of ${maxSizeBytes} bytes`,
    );
  }
}
