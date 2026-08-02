import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "@hh/config";
import { LoggerModule } from "nestjs-pino";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Structured JSON logging (pino) with request-id correlation. Every request
 * gets an `x-request-id` (reused from the incoming header when present, so a
 * reverse proxy or client-supplied id survives end to end) echoed back on the
 * response and attached to every log line for that request. Sensitive
 * headers/fields are redacted at the logger level, never opt-in per call
 * site.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.nodeEnv === "test" ? "silent" : config.nodeEnv === "production" ? "info" : "debug",
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const existing = req.headers["x-request-id"];
            const id = (typeof existing === "string" && existing) || randomUUID();
            res.setHeader("x-request-id", id);
            return id;
          },
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              'req.body.password',
              'req.body.refreshToken',
              'req.body["password"]',
              'res.headers["set-cookie"]',
            ],
            censor: "[REDACTED]",
          },
          ...(config.nodeEnv === "development"
            ? { transport: { target: "pino-pretty", options: { singleLine: true, translateTime: "HH:MM:ss" } } }
            : {}),
        },
      }),
    }),
  ],
})
export class LoggingModule {}
