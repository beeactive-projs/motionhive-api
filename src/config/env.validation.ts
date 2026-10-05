import * as Joi from 'joi';

/**
 * Environment Variables Validation Schema
 *
 * This ensures all required environment variables are present when the app starts.
 * If any required variable is missing, the app will crash immediately with a clear error.
 *
 * Think of this as a "contract" - the app won't start unless all these are provided.
 */
export const envValidationSchema = Joi.object({
  // Node Environment
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Server Configuration
  PORT: Joi.number().default(3000),

  // Database Configuration
  // DATABASE_URL is the preferred way (Neon connection string)
  // Individual vars (DB_* or PG*) as fallback
  DATABASE_URL: Joi.string().optional(),
  DB_HOST: Joi.string().optional(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().optional(),
  DB_PASSWORD: Joi.string().optional(),
  DB_DATABASE: Joi.string().optional(),
  PGHOST: Joi.string().optional(),
  PGPORT: Joi.number().optional(),
  PGUSER: Joi.string().optional(),
  PGPASSWORD: Joi.string().optional(),
  PGDATABASE: Joi.string().optional(),

  // Redis Configuration — required for BullMQ queues. Required in
  // production; optional in dev/test so a developer without Redis
  // running can still boot the API (the JobsModule degrades to a
  // no-op enqueue + logs a warning).
  REDIS_HOST: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional(),
  // Set to "true" when using Redis Cloud / managed Redis (TLS-enabled).
  // Local Docker Redis runs without TLS so this defaults to false.
  REDIS_TLS: Joi.string().valid('true', 'false').default('false'),

  // Job schedulers (@Cron). Default 'true'. Set to 'false' on
  // environments that shouldn't run periodic work (e.g. dev), so the
  // DB-querying crons don't keep Postgres awake. Workers still run; only
  // the cron producers are skipped.
  SCHEDULERS_ENABLED: Joi.string().valid('true', 'false').default('true'),

  // Apple Push Notification service. All optional: without them the
  // transport reports itself unconfigured and iOS pushes are skipped,
  // the same posture as running without Redis. APNS_PRIVATE_KEY holds
  // the .p8 contents (newlines escaped), not a path — Railway has no
  // filesystem to keep a key file on.
  APNS_KEY_ID: Joi.string().optional(),
  APNS_TEAM_ID: Joi.string().optional(),
  APNS_BUNDLE_ID: Joi.string().optional(),
  APNS_PRIVATE_KEY: Joi.string().optional(),
  // Sandbox by default. A token minted by a development build is
  // rejected outright by the production host, so this must match the
  // build that registered the device.
  APNS_PRODUCTION: Joi.string().valid('true', 'false').default('false'),

  // Firebase Cloud Messaging, for Android. Optional on the same terms
  // as APNs: absent means Android pushes are skipped, not that the app
  // fails to boot. Values come from a service-account key in the
  // Firebase console under Project settings, Service accounts.
  FIREBASE_PROJECT_ID: Joi.string().optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().optional(),

  // Bull Board admin UI — mounted at /admin/queues. Protected with
  // HTTP basic auth so we don't have to wire JWT into the Express
  // middleware that Bull Board ships with. Both vars must be set
  // for the UI to mount; missing either disables it (the route 404s).
  BULL_BOARD_USER: Joi.string().optional(),
  BULL_BOARD_PASSWORD: Joi.string().min(12).optional(),

  // JWT Configuration (CRITICAL - no defaults allowed!)
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('2h'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Frontend URL for CORS (required in production)
  FRONTEND_URL: Joi.string().uri().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // Public marketing site origin (no trailing slash). Used ONLY for the blog
  // sitemap's absolute URLs. Deliberately separate from FRONTEND_URL, which
  // points at the authenticated app (`app.`) for CORS, emails and redirects;
  // blog articles live on the marketing site and `app.` redirects to login.
  PUBLIC_SITE_URL: Joi.string().uri().default('https://www.motionhive.fit'),

  // Vercel Deploy Hook for the marketing site. Optional: when set, publishing/
  // editing/deleting a published blog post POSTs here to rebuild the
  // prerendered site so the new article HTML is generated. Unset → no-op.
  WEBSITE_DEPLOY_HOOK_URL: Joi.string().uri().optional(),

  // Bcrypt rounds (default: 12)
  BCRYPT_ROUNDS: Joi.number().min(10).max(15).default(12),

  // Resend API key for sending emails
  // Optional in dev (emails logged to console), recommended for all environments
  RESEND_API_KEY: Joi.string().optional(),

  // Email sender configuration
  EMAIL_FROM: Joi.string().email().optional(),
  EMAIL_FROM_NAME: Joi.string().optional(),

  // OAuth (optional – required only when using social login)
  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),
  FACEBOOK_APP_ID: Joi.string().optional(),
  FACEBOOK_APP_SECRET: Joi.string().optional(),

  // Cloudinary (optional – for image uploads)
  CLOUDINARY_CLOUD_NAME: Joi.string().optional(),
  CLOUDINARY_API_KEY: Joi.string().optional(),
  CLOUDINARY_API_SECRET: Joi.string().optional(),

  // ===================================================================
  // Stripe Configuration (Payments & Invoicing)
  // ===================================================================
  // All Stripe vars are optional in dev/test so the app can boot without
  // them, but PaymentModule will refuse to process real requests unless
  // STRIPE_SECRET_KEY is present. In production they become effectively
  // required via a runtime assertion in StripeService.
  //
  // Keys:
  //   STRIPE_SECRET_KEY     server-side only, NEVER ship to client (sk_...)
  //   STRIPE_PUBLISHABLE_KEY safe to expose to frontend (pk_...)
  //   STRIPE_WEBHOOK_SECRET verifies webhook signatures (whsec_...)
  //   STRIPE_CONNECT_CLIENT_ID Connect platform client id (ca_...)
  //   STRIPE_API_VERSION    pinned API version — never rely on SDK default
  //   DEFAULT_PLATFORM_FEE_BPS basis points (0 = 0%, 100 = 1%) applied by default
  STRIPE_SECRET_KEY: Joi.string().min(20).optional(),
  STRIPE_PUBLISHABLE_KEY: Joi.string().min(20).optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().min(20).optional(),
  STRIPE_CONNECT_CLIENT_ID: Joi.string().optional(),
  STRIPE_API_VERSION: Joi.string().default('2026-03-25.dahlia'),
  STRIPE_ALLOW_TEST_KEY_IN_PROD: Joi.string()
    .valid('true', 'false')
    .default('false'),
  DEFAULT_PLATFORM_FEE_BPS: Joi.number().min(0).max(10000).default(0),
});
