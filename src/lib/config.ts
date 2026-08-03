import { z } from "zod";

// Single source of truth for all environment configuration. Every other
// module reads config.* instead of process.env directly, so what's
// configurable is visible in one place and validated once, eagerly, at
// startup — instead of failing lazily and confusingly deep inside whichever
// tool call happens to touch a missing var first.

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).optional(),

  // This app's own database (Prisma). Required.
  APP_DATABASE_URL: z.string().min(1, "APP_DATABASE_URL is required — see .env.example."),

  // Claude Agent SDK. Optional — falls back to `claude login` on this machine.
  ANTHROPIC_API_KEY: z.string().optional(),

  // Auth.js. Secret required; Google sign-in optional.
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required — see .env.example."),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),

  // Resend (forgot-password emails). Optional — falls back to a
  // console-logged reset link.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // The agent's run_readonly_query tool — a user's own external database for
  // QA validation. Unrelated to APP_DATABASE_URL above. Optional.
  DB_ENGINE: z.string().optional(),
  DATABASE_URL: z.string().optional(),

  // Jira. Optional.
  JIRA_BASE_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),

  // Cloudflare R2 (S3-compatible) — required, this is where uploaded
  // documents, .xlsx exports, and generated .docx files actually live.
  R2_ACCOUNT_ID: z.string().min(1, "R2_ACCOUNT_ID is required — see .env.example."),
  R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required — see .env.example."),
  R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required — see .env.example."),
  R2_BUCKET_NAME: z.string().min(1, "R2_BUCKET_NAME is required — see .env.example."),

  // Error monitoring. Optional — errors just stay in the Pino logs when unset.
  SENTRY_DSN: z.string().optional(),

  // Analytics. Optional — events are simply not tracked when unset.
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().optional(),
});

const parsedEnv = EnvSchema.safeParse(process.env);
if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
}
const env = parsedEnv.data;

function buildReadonlyQueryDbConfig() {
  if (!env.DB_ENGINE && !env.DATABASE_URL) return null;
  if (!env.DB_ENGINE || !env.DATABASE_URL) return null; // lenient — same as before: both-or-neither, no error
  const engine = env.DB_ENGINE.toLowerCase();
  if (engine !== "postgres" && engine !== "mysql") {
    throw new Error(`DB_ENGINE must be "postgres" or "mysql", got "${env.DB_ENGINE}".`);
  }
  return { engine: engine as "postgres" | "mysql", connectionString: env.DATABASE_URL };
}

export const config = {
  isProduction: env.NODE_ENV === "production",
  logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug"),

  database: { url: env.APP_DATABASE_URL },

  anthropic: { apiKey: env.ANTHROPIC_API_KEY ?? null },

  auth: {
    secret: env.AUTH_SECRET,
    google:
      env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET
        ? { clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }
        : null,
  },

  email:
    env.RESEND_API_KEY && env.EMAIL_FROM
      ? { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }
      : null,

  readonlyQueryDb: buildReadonlyQueryDbConfig(),

  jira:
    env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN
      ? {
          baseUrl: env.JIRA_BASE_URL.replace(/\/+$/, ""),
          email: env.JIRA_EMAIL,
          apiToken: env.JIRA_API_TOKEN,
        }
      : null,

  r2: {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName: env.R2_BUCKET_NAME,
  },

  sentry: env.SENTRY_DSN ? { dsn: env.SENTRY_DSN } : null,

  posthog: env.POSTHOG_API_KEY
    ? { apiKey: env.POSTHOG_API_KEY, host: env.POSTHOG_HOST ?? "https://us.i.posthog.com" }
    : null,
} as const;
