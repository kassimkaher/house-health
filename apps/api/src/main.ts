import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1", { exclude: ["health/live", "health/ready"] });
  app.enableShutdownHooks();
  // 3100 default: port 3000 belongs to another app on the shared dev host.
  const port = Number(process.env.API_PORT ?? 3100);
  await app.listen(port);
}

void bootstrap();
