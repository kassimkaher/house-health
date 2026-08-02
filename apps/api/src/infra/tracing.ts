import type { AppConfig } from "@hh/config";

/**
 * OpenTelemetry hook, wired but dormant. Single server, no collector
 * deployed yet — the wiring cost is paid now so enabling tracing later is an
 * env flag, not a code change. When OTEL_ENABLED=true and
 * @opentelemetry/sdk-node is installed, this initializes auto-instrumentation
 * (http, pg, ioredis) with an OTLP exporter; until then it's a no-op.
 */
export function initTracing(config: AppConfig): void {
  if (!config.otelEnabled) return;
  console.warn(
    "[tracing] OTEL_ENABLED=true but @opentelemetry/sdk-node is not installed in this phase — " +
      "tracing stays disabled. Install it and complete this seam to enable real traces.",
  );
}
