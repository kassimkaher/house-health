import { Controller, Get, Header, Injectable, Module, type NestMiddleware } from "@nestjs/common";
import { type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { Public } from "@hh/auth";
import type { NextFunction, Request, Response } from "express";
import * as client from "prom-client";

/**
 * Prometheus metrics. Process defaults (CPU/memory/event-loop) plus request
 * duration and count by route/method/status. `/metrics` is unauthenticated
 * at the app layer — Nginx restricts it to the internal network in
 * production (see docs/runbooks/deploy.md); it carries no user data.
 */
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});

export const authFailuresTotal = new client.Counter({
  name: "auth_failures_total",
  help: "Authentication failures by reason",
  labelNames: ["reason"],
  registers: [registry],
});

@Injectable()
class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      // Use the matched route pattern, not the raw path, to keep label
      // cardinality bounded (no per-id explosion).
      const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
      const labels = { method: req.method, route, status: String(res.statusCode) };
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestDuration.observe(labels, seconds);
      httpRequestsTotal.inc(labels);
    });
    next();
  }
}

@Public()
@Controller("metrics")
class MetricsController {
  @Get()
  @Header("content-type", client.register.contentType)
  async scrape(): Promise<string> {
    return registry.metrics();
  }
}

@Module({ controllers: [MetricsController] })
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes("*");
  }
}
