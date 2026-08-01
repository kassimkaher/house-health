import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createServer } from "node:http";
import { WorkerModule } from "./worker.module";

/**
 * The worker is a headless Nest application context (no HTTP framework),
 * plus a tiny raw HTTP server exposing /health/live and /metrics for
 * compose healthchecks and Prometheus scraping.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const port = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
  const server = createServer((req, res) => {
    if (req.url === "/health/live") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port);

  const shutdown = async (): Promise<void> => {
    server.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

void bootstrap();
