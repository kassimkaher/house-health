import {
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { ERROR_CODES } from "@hh/contracts";
import { ERROR_TRACKING_PORT, type ErrorTrackingPort } from "@hh/notifications";
import type { Request, Response } from "express";
import { PinoLogger } from "nestjs-pino";

type RequestWithId = Request & {
  id?: string | number;
  user?: { userId?: string };
};

/**
 * Last-resort handler for anything that isn't an HttpException (Prisma
 * errors, programming errors, etc). Known HttpExceptions pass through with
 * their body untouched — this filter's job is to (a) never leak a stack
 * trace to the client and (b) always attach a `code` so clients never see a
 * bodyless 500. Every 5xx is reported to the error-tracking port.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(ERROR_TRACKING_PORT) private readonly errorTracking: ErrorTrackingPort,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : null;

    if (status >= 500) {
      this.errorTracking.captureException(exception, {
        requestId: typeof request.id === "string" ? request.id : String(request.id ?? ""),
        userId: request.user?.userId,
        tags: { path: request.path, method: request.method },
      });
      this.logger.error({ err: exception }, "unhandled exception");
    }

    if (isHttp && body && typeof body === "object") {
      response.status(status).json(body);
      return;
    }

    response.status(status).json({
      code: ERROR_CODES.INTERNAL,
      message: isHttp ? exception.message : "internal server error",
    });
  }
}
