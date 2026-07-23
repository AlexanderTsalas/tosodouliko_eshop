import { z } from "zod";

const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Stripe — OPTIONAL by design. The payment layer reads these via raw
  // process.env (not this validated `env` object) and falls back to the
  // mock provider when STRIPE_SECRET_KEY is unset or a placeholder (see
  // src/lib/payment/index.ts → activeProviderKind). So a deployment with no
  // Stripe config builds and runs end-to-end in mock mode; setting real
  // keys flips checkout to live Stripe. Marking these required here would
  // (and did) fail the build for mock/preview deploys that legitimately
  // have no Stripe secrets. NOTE: prod with Stripe unset silently runs
  // MOCK payments — gate on PAYMENT_PROVIDER / a deploy check if that
  // matters for your environment.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // External integrations (optional during local development)
  CRM_API_KEY: z.string().optional().default(""),
  CRM_API_URL: z.string().optional().default(""),
  COURIER_API_KEY: z.string().optional().default(""),
  COURIER_API_URL: z.string().optional().default(""),
  MARKETPLACE_API_KEY: z.string().optional().default(""),
  MARKETPLACE_API_URL: z.string().optional().default(""),
  NEWSLETTER_API_KEY: z.string().optional().default(""),
  NEWSLETTER_API_URL: z.string().optional().default(""),

  // App
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.string().default("el"),
  NEXT_PUBLIC_DEFAULT_CURRENCY: z.string().default("EUR"),

  // Shared bearer secret for cron endpoints (currently
  // /api/cron/wishlist-advance). Required in production — the route returns
  // 500 if NODE_ENV='production' and CRON_SECRET is unset. Optional in dev
  // (the route accepts unauthenticated calls). Min length 32 deters guessing
  // attacks on the bearer header.
  CRON_SECRET: z.string().min(32).optional(),

  // Image hostname allowlist for next/image — comma-separated patterns.
  // Read by next.config.mjs at config-load time. Defaults to Supabase
  // public storage host so the storefront keeps working without explicit
  // config. Per-deployment example values:
  //   Supabase Cloud:     **.supabase.co
  //   Cloudflare R2:      cdn.yourshop.gr,**.r2.cloudflarestorage.com
  //   MinIO on VPS:       storage.yourshop.gr
  IMAGE_HOSTNAMES: z.string().optional().default("**.supabase.co"),

  // Storage abstraction backend selector (src/lib/storage/index.ts).
  // Determines which provider implementation is constructed at first use.
  // All providers share the same StorageProvider interface — swapping
  // requires only env-var change + (for S3-flavors) installing the AWS SDK.
  STORAGE_PROVIDER: z
    .enum(["supabase", "s3", "r2", "minio", "b2"])
    .optional()
    .default("supabase"),

  // Opt-in server-side image conversion fallback. When true AND the
  // browser somehow uploads a non-WebP file (client conversion bypass),
  // the server-side recordProductImage action attempts to convert via
  // sharp before rejecting. Disabled by default to keep deployments
  // free of the sharp native binary dependency.
  SERVER_SIDE_FORMAT_FALLBACK: z.enum(["true", "false"]).optional().default("false"),

  // Encryption secrets for at-rest data (hex-encoded AES keys).
  // Optional in dev so local development doesn't hard-fail; required
  // in production for the corresponding features to work correctly.
  // Generate with:  openssl rand -hex 32
  CARRIER_SECRETS_KEY: z.string().optional(),
  EMAIL_SECRETS_KEY: z.string().optional(),

  // Pepper for MFA enrollment-token / recovery-code hashing. Must be >= 32
  // characters to match the runtime check in src/lib/mfa/tokens.ts (pepper()).
  // Optional so the app boots without MFA in dev, but REQUIRED in production:
  // if unset, every MFA token mint / validate / recovery throws at runtime and
  // internal-user onboarding is impossible. Generate with `openssl rand -base64 32`.
  MFA_TOKEN_PEPPER: z.string().min(32).optional(),

  // Payment provider selector. Defaults are env-derived in
  // src/lib/payment/index.ts: if STRIPE_SECRET_KEY is set, stripe is
  // chosen automatically; otherwise mock. Explicit override here for
  // testing/staging.
  PAYMENT_PROVIDER: z.enum(["stripe", "mock"]).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    parsed.error.flatten().fieldErrors
  );
  throw new Error("Invalid environment variables — see logs above");
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
