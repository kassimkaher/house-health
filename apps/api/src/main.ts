import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadConfig } from "@hh/config";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { initTracing } from "./infra/tracing";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // Validate env before Nest boots so failures are readable, not DI noise.
  const config = loadConfig();
  initTracing(config);

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("api/v1", { exclude: ["health/live", "health/ready", "metrics"] });
  app.use(cookieParser());
  app.use(
    helmet({
      // The admin dashboard is a separate origin (Next.js), so a strict
      // same-origin CSP here would only ever break Swagger UI's inline
      // assets outside production; disable CSP and rely on the reverse
      // proxy's CSP for browser-rendered surfaces (see infrastructure/nginx).
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.enableCors({
    origin: [config.adminWebOrigin, ...config.corsOrigins],
    credentials: true,
  });
  app.enableShutdownHooks();

  if (config.nodeEnv !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Health House API")
      .setDescription("Nutrition & calorie platform — public /api/v1")
      .setVersion("v1")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/docs", app, document);
  }

  await app.listen(config.apiPort);
}

void bootstrap();
