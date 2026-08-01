import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadConfig } from "@hh/config";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // Validate env before Nest boots so failures are readable, not DI noise.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1", { exclude: ["health/live", "health/ready"] });
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
