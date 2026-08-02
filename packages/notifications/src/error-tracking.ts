export interface ErrorContext {
  requestId?: string | undefined;
  userId?: string | undefined;
  tags?: Record<string, string> | undefined;
}

/**
 * Provider-neutral error-tracking port. The log provider (default) writes a
 * structured line to stdout, which the deployed pino/JSON logging pipeline
 * already captures — sufficient until a real APM/error-tracking service
 * (Sentry, etc.) is configured via ERROR_TRACKING_DSN.
 */
export interface ErrorTrackingPort {
  captureException(error: unknown, context?: ErrorContext): void;
}

export const ERROR_TRACKING_PORT = "ERROR_TRACKING_PORT";

export class LogErrorTrackingProvider implements ErrorTrackingPort {
  captureException(error: unknown, context?: ErrorContext): void {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        level: "error",
        msg: err.message,
        stack: err.stack,
        ...context,
      }),
    );
  }
}
