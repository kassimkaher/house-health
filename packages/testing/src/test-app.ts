import "reflect-metadata";
import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { type INestApplication, type Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { EMAIL_PORT } from "@hh/notifications";
import { RecordingEmailProvider } from "./recording-email.provider";

let migrated = false;

/**
 * Apply Prisma migrations to the database at DATABASE_URL. Runs once per jest
 * worker process; the integration stack (scripts/test-integration.sh) exports
 * the throwaway database's URL before the suite starts.
 */
export function ensureTestDatabaseMigrated(): void {
  if (migrated) {
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set for integration tests");
  }
  const databaseDir = dirname(require.resolve("@hh/database/package.json"));
  execSync("npx prisma migrate deploy", {
    cwd: databaseDir,
    env: process.env,
    stdio: "pipe",
  });
  migrated = true;
}

export interface TestAppContext {
  app: INestApplication;
  email: RecordingEmailProvider;
}

/**
 * Boot the real application module against the test stack, with the email
 * port replaced by a RecordingEmailProvider. Mirrors main.ts wiring (global
 * /api/v1 prefix); the caller owns `app.close()`.
 */
export async function createTestApp(rootModule: Type<unknown>): Promise<TestAppContext> {
  ensureTestDatabaseMigrated();
  const email = new RecordingEmailProvider();
  const moduleRef = await Test.createTestingModule({ imports: [rootModule] })
    .overrideProvider(EMAIL_PORT)
    .useValue(email)
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1", { exclude: ["health/live", "health/ready"] });
  await app.init();
  return { app, email };
}

interface TruncateClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
  $executeRawUnsafe(query: string): Promise<number>;
}

/** Truncate every public table except Prisma's migration bookkeeping. */
export async function truncateAllTables(prisma: TruncateClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  if (rows.length === 0) {
    return;
  }
  const tables = rows.map((row) => `"${row.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
