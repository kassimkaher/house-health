import "reflect-metadata";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "../src/app.module";

/**
 * Boots the app without listening on a port, dumps the OpenAPI document to
 * docs/openapi.json, and exits. CI compares this artifact against the
 * committed copy (scripts/ci.sh) — drift means the docs weren't regenerated
 * after an API change.
 */
async function main(): Promise<void> {
  // NOT `logger: false` — that silences Nest's own bootstrap-failure log
  // line too, so a DI/config error here exits with no output at all,
  // making failures here nearly unreproducible-looking (learned the hard
  // way: a missing DATABASE_URL crashed this with zero stderr).
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  const config = new DocumentBuilder()
    .setTitle("Health House API")
    .setDescription("Nutrition & calorie platform — public /api/v1 and admin /api/v1/admin")
    .setVersion("v1")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const outPath = join(__dirname, "..", "..", "..", "docs", "openapi.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
  console.warn(`Wrote ${outPath}`);

  await app.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
