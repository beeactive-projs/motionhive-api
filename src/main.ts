import { NestFactory } from '@nestjs/core';
import {
  BadRequestException,
  ValidationPipe,
  Logger,
  LoggerService,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import helmet from 'helmet';
import * as express from 'express';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { validationErrorBody } from './common/i18n';
import { setupBullBoard } from './modules/jobs/bull-board.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get<LoggerService>(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  // Trust exactly one proxy hop (Railway's edge). Without this, Express
  // reports req.ip as the load-balancer IP and per-IP throttling
  // collapses onto a single shared bucket. Do NOT use `true` — it
  // trusts the leftmost X-Forwarded-For entry, which an attacker can
  // set directly. Bump to 2 if Cloudflare ever sits in front.
  app.set('trust proxy', 1);

  app.useGlobalFilters(new HttpExceptionFilter(logger));

  // Stripe signs the raw request bytes. Re-serialized JSON breaks the
  // signature check, so express.raw() is scoped to /webhooks/stripe
  // only. Must run before useGlobalPipes().
  app.use(
    '/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '1mb' }),
  );

  app.use(
    helmet({
      // CSP off in dev so Swagger UI works.
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production' ? undefined : false,
      hsts: process.env.NODE_ENV === 'production',
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      // One translated sentence instead of class-validator's English
      // property-by-property messages (those stay in `details`).
      exceptionFactory: (errors) =>
        new BadRequestException(validationErrorBody(errors)),
    }),
  );

  // Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('MotionHive API')
    .setDescription(
      `
# MotionHive Fitness Platform API

A comprehensive REST API for managing fitness training sessions, trainers, and clients.

---

## User Journey Flow

### 1. Registration & Login
- **POST /auth/register** — Create account (auto-assigned USER role)
- Verify email via link (GET /auth/verify-email in dev, frontend in prod)
- **POST /auth/login** — Get JWT access + refresh tokens
- **POST /auth/google** — Sign in with Google. Body: idToken (Google ID token from frontend). Creates or links account, returns same JWT + user as login.
- **POST /auth/facebook** — Sign in with Facebook. Body: accessToken (from frontend). Requires FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in env.

### 2. Complete Your Profile
- **GET /profile/me** — See your full profile overview
- **PATCH /profile/me** — Update user + user profile + instructor in one call
- **PATCH /profile/user-profile** — Update health & fitness data

### 3. Become an Instructor
- **POST /profile/instructor** — Activate instructor profile (gets INSTRUCTOR role)
- **PATCH /profile/instructor** — Fill in professional details (bio, specializations)

### 4. Create a Group
- **POST /groups** — Create your fitness group (requires INSTRUCTOR role)
- You become the OWNER of the group
- **PATCH /groups/:id** — Update details (slug auto-regenerates on name change)

### 5. Invite Members
- **POST /invitations** — Send invitation to someone's email
- They receive an email and can accept/decline
- **POST /invitations/:token/accept** — Invitee accepts and joins the group

### 6. Create & Manage Sessions
- **POST /sessions** — Create training sessions (linked to your group). Supports recurring: set \`isRecurring\` and \`recurringRule\` (frequency, daysOfWeek, endDate). See USER-FLOWS.md § Flow 10 for the full rule format.
- **GET /sessions/:id/recurrence-preview?weeks=12** — Preview upcoming occurrence dates (for calendar UI)
- **POST /sessions/:id/generate-instances** — Create session rows for the next N weeks from a recurring template
- **GET /sessions/discover** — Browse public sessions
- **POST /sessions/:id/clone** — Duplicate a session for another date

### 7. Participate in Sessions
- **POST /sessions/:id/join** — Register for a session
- **POST /sessions/:id/confirm** — Confirm your attendance
- **POST /sessions/:id/checkin** — Self check-in (15 min before to 30 min after)
- **POST /sessions/:id/leave** — Cancel (2-hour cancellation policy)

---

## Features
- JWT-based auth with refresh tokens
- Role-based access (USER, INSTRUCTOR, ADMIN)
- Email via Resend (verification, password reset, invitations)
- Session management with visibility rules (PRIVATE, GROUP, CLIENTS, PUBLIC)
- Group management with membership & health data sharing
- Instructor-client relationships
- Cancellation policies and self check-in
- Rate limiting on sensitive endpoints

## Documentation
- **USER-FLOWS.md** — All flows, recurrence rule format, examples, and frontend usage
- **DEPLOY.md** — Migrations on deploy and start command setup

## Security
- Passwords hashed with bcrypt (12 rounds)
- All tokens (reset, verification, invitation) hashed before storage
- HTTPS required in production
- Security headers via Helmet
- Input validation and sanitization
    `.trim(),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your JWT access token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag(
      'Authentication',
      'User registration, login, and password management',
    )
    .addTag('Users', 'User account management')
    .addTag('Profiles', 'User & instructor profiles')
    .addTag('Groups', 'Group management and membership')
    .addTag('Clients', 'Instructor-client relationships')
    .addTag('Sessions', 'Training session management')
    .addTag('Invitations', 'Invitation management')
    .addTag('Analytics', 'Analytics and reporting')
    .addTag(
      'Payments',
      'Stripe Connect onboarding, products, invoices, subscriptions, refunds',
    )
    .addTag(
      'Payments (Client)',
      'Client-side billing: saved cards, invoices, subscriptions',
    )
    .addTag(
      'Payments (Webhooks)',
      'Stripe webhook receiver — public, signature-verified',
    )
    .addTag('Health', 'Application health checks')
    .addServer('http://localhost:3000', 'Local development')
    .addServer('https://motionhive-api-production.up.railway.app', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'MotionHive API Documentation',
    customfavIcon: 'https://nestjs.com/img/logo-small.svg',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 50px 0 }
      .swagger-ui .info .title { font-size: 2.5em }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      tagsSorter: 'alpha',
    },
  });

  const productionOrigins = (
    [
      process.env.FRONTEND_URL,
      'https://motionhive.fit',
      'https://www.motionhive.fit',
      'https://app.motionhive.fit',
      'https://dev.motionhive.fit',
      'https://app-dev.motionhive.fit',
      'https://admin.motionhive.fit',
      'https://admin-dev.motionhive.fit',
      'https://dev.admin.motionhive.fit',
      // Capacitor WebView origins (mobile app): iOS / Android
      'capacitor://localhost',
      'https://localhost',
      /\.vercel\.app$/,
      /\.railway\.app$/,
      /\.netlify\.app$/,
    ] as (string | RegExp | undefined)[]
  ).filter((o): o is string | RegExp => Boolean(o));

  const developmentOrigins = [
    'http://localhost:4200',
    'http://localhost:4203', // admin app
    'http://localhost:3000',
    'http://localhost:8100',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:4200',
    'http://127.0.0.1:4203', // admin app
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8100',
    // The Capacitor app is not served over http — its WebView has its own
    // origin, and without these the browser discards every reply as
    // cross-origin. The symptom is not a network error: the request
    // succeeds, the response is thrown away, and a login looks like wrong
    // credentials.
    'capacitor://localhost', // iOS
    'http://localhost', // Android
    'ionic://localhost', // iOS, Capacitor 2 and earlier
  ];

  // Comma-separated extra origins for prod (e.g. tunnel hosts during a
  // demo). DEV_ORIGINS=http://localhost:4200,http://192.168.1.100:4200
  const additionalDevOrigins = process.env.DEV_ORIGINS
    ? process.env.DEV_ORIGINS.split(',').map((origin) => origin.trim())
    : [];

  const allowedOrigins =
    process.env.NODE_ENV === 'production'
      ? [...productionOrigins, ...additionalDevOrigins]
      : developmentOrigins;

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'Accept',
      // The apps send their UI language; error messages answer in it.
      'Accept-Language',
      'Origin',
    ],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 3600,
  });

  // No-op when BULL_BOARD_USER / BULL_BOARD_PASSWORD aren't set —
  // see modules/jobs/bull-board.setup.ts.
  setupBullBoard(app, new Logger('BullBoard'));

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  const appLogger = new Logger('Bootstrap');
  appLogger.log(`🚀 Application is running on: http://localhost:${port}`);
  appLogger.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  appLogger.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
  appLogger.log(`💚 Health check: http://localhost:${port}/health`);

  // Railway/Docker sends SIGTERM on container stop; we drain in-flight
  // requests + close DB connections before exiting.
  const gracefulShutdown = async (signal: string) => {
    appLogger.warn(`${signal} signal received: closing HTTP server`);

    try {
      await app.close();
      appLogger.log('HTTP server closed successfully');
      process.exit(0);
    } catch (error) {
      appLogger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });

  process.on('uncaughtException', (error) => {
    appLogger.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    appLogger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}

void bootstrap();
