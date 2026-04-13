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

  // Redis Configuration (optional — only needed when using Bull queues)
  REDIS_HOST: Joi.string().optional(),
  REDIS_PORT: Joi.number().default(6379),

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
  DEFAULT_PLATFORM_FEE_BPS: Joi.number().min(0).max(10000).default(0),
});
