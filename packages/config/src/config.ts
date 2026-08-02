import { generateKeyPairSync } from "node:crypto";
import { z } from "zod";

/** Injection token under which apps provide the loaded AppConfig. */
export const APP_CONFIG = "APP_CONFIG";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1, "required (postgres connection string)"),
  REDIS_URL: z.string().min(1, "required (redis connection string)"),
  APP_BASE_URL: z.string().url().default("http://localhost:3100"),
  ADMIN_WEB_ORIGIN: z.string().url().default("http://localhost:3002"),
  /** Comma-separated list of additional allowed CORS origins. */
  CORS_ORIGINS: z.string().default(""),
  JWT_PRIVATE_KEY_PEM: z.string().min(1).optional(),
  JWT_PUBLIC_KEY_PEM: z.string().min(1).optional(),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  S3_ENDPOINT: z.string().url().default("http://127.0.0.1:9100"),
  S3_ACCESS_KEY: z.string().default("hh_minio"),
  S3_SECRET_KEY: z.string().default("hh_dev_minio_password"),
  S3_BUCKET_PREFIX: z.string().regex(/^[a-z0-9-]+$/).default("hh"),
  OTEL_ENABLED: z.coerce.boolean().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  ERROR_TRACKING_DSN: z.string().min(1).optional(),
});

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  apiPort: number;
  databaseUrl: string;
  redisUrl: string;
  appBaseUrl: string;
  adminWebOrigin: string;
  corsOrigins: string[];
  jwtPrivateKeyPem: string;
  jwtPublicKeyPem: string;
  accessTokenTtlSec: number;
  refreshTokenTtlDays: number;
  /** Present only when the full GOOGLE_* trio is configured. */
  google: GoogleOidcConfig | null;
  s3: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucketPrefix: string;
  };
  otelEnabled: boolean;
  otelExporterOtlpEndpoint: string | null;
  errorTrackingDsn: string | null;
}

/** Thrown when environment validation fails; message lists every bad field. */
export class ConfigValidationError extends Error {
  constructor(problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "ConfigValidationError";
  }
}

function generateEphemeralKeypair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/**
 * Load and validate configuration from the environment. Fails fast with a
 * readable message listing every invalid field. Outside production a missing
 * JWT keypair is replaced by an ephemeral P-256 pair (tokens die on restart);
 * in production its absence is fatal.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }
  const e = parsed.data;

  const problems: string[] = [];

  let privatePem = e.JWT_PRIVATE_KEY_PEM;
  let publicPem = e.JWT_PUBLIC_KEY_PEM;
  if (privatePem === undefined || publicPem === undefined) {
    if (privatePem !== undefined || publicPem !== undefined) {
      problems.push(
        "JWT_PRIVATE_KEY_PEM / JWT_PUBLIC_KEY_PEM: provide both PEMs or neither",
      );
    } else if (e.NODE_ENV === "production") {
      problems.push(
        "JWT_PRIVATE_KEY_PEM, JWT_PUBLIC_KEY_PEM: required in production (ES256 P-256 PEM pair)",
      );
    } else {
      const pair = generateEphemeralKeypair();
      privatePem = pair.privatePem;
      publicPem = pair.publicPem;
      if (e.NODE_ENV !== "test") {
        console.warn(
          "[config] JWT_PRIVATE_KEY_PEM/JWT_PUBLIC_KEY_PEM not set — generated an EPHEMERAL P-256 keypair. All issued access tokens become invalid on restart.",
        );
      }
    }
  }

  const googleFields = [e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET, e.GOOGLE_REDIRECT_URI];
  const googleSet = googleFields.filter((v) => v !== undefined).length;
  let google: GoogleOidcConfig | null = null;
  if (googleSet === 3) {
    google = {
      clientId: e.GOOGLE_CLIENT_ID as string,
      clientSecret: e.GOOGLE_CLIENT_SECRET as string,
      redirectUri: e.GOOGLE_REDIRECT_URI as string,
    };
  } else if (googleSet !== 0) {
    problems.push(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI: set all three or none",
    );
  }

  if (problems.length > 0) {
    throw new ConfigValidationError(problems);
  }

  return {
    nodeEnv: e.NODE_ENV,
    apiPort: e.API_PORT,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    appBaseUrl: e.APP_BASE_URL,
    adminWebOrigin: e.ADMIN_WEB_ORIGIN,
    corsOrigins: e.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    jwtPrivateKeyPem: privatePem as string,
    jwtPublicKeyPem: publicPem as string,
    accessTokenTtlSec: e.ACCESS_TOKEN_TTL_SEC,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    google,
    s3: {
      endpoint: e.S3_ENDPOINT,
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
      bucketPrefix: e.S3_BUCKET_PREFIX,
    },
    otelEnabled: e.OTEL_ENABLED,
    otelExporterOtlpEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
    errorTrackingDsn: e.ERROR_TRACKING_DSN ?? null,
  };
}
