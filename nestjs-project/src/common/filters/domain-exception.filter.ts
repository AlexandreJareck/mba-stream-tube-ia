import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import {
  DomainException,
  RangeNotSatisfiableException,
} from '../exceptions/domain.exception';

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof RangeNotSatisfiableException) {
      // RFC 9110 §15.5.17: a 416 states the current representation length.
      response.setHeader('Content-Range', `bytes */${exception.sizeBytes}`);
    }

    response.status(exception.httpStatus).json({
      statusCode: exception.httpStatus,
      error: exception.errorCode,
      message: exception.message,
    });
  }
}
