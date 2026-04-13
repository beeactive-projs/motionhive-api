import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getDatabaseConfig } from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import { createLogger } from './common/logger/winston.config';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { RoleModule } from './modules/role/role.module';
import { HealthModule } from './modules/health/health.module';
import { ProfileModule } from './modules/profile/profile.module';
import { GroupModule } from './modules/group/group.module';
import { SessionModule } from './modules/session/session.module';
import { InvitationModule } from './modules/invitation/invitation.module';
import { ClientModule } from './modules/client/client.module';
import { BlogModule } from './modules/blog/blog.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';
import { PaymentModule } from './modules/payment/payment.module';
import { CamelCaseInterceptor } from './common/interceptors/camel-case.interceptor';

/**
 * App Module
 *
 * The root module of the application.
 * This is where we import and configure all global modules:
 * - Configuration (environment variables)
 * - Database (Sequelize/MySQL)
 * - Queue system (Bull/Redis)
 * - Logging (Winston)
 * - Rate limiting (Throttler)
 * - Feature modules (User, Auth, Role, etc.)
 *
 * NestJS uses dependency injection, so everything declared here
 * is available throughout the application.
 */
@Module({
  imports: [
    // ✅ IMPROVEMENT: Environment variable validation
    // App won't start if required env vars are missing
    ConfigModule.forRoot({
      isGlobal: true, // Make ConfigService available everywhere
      validationSchema: envValidationSchema, // Validate env vars on startup
      validationOptions: {
        abortEarly: false, // Show all validation errors, not just first one
      },
    }),

    // ✅ IMPROVEMENT: Winston logger (replaces console.log)
    WinstonModule.forRootAsync({
      useFactory: () => createLogger(),
    }),

    // Database Configuration
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getDatabaseConfig,
    }),

    // Redis/Bull Queue Configuration (only when REDIS_HOST is set)
    ...(process.env.REDIS_HOST
      ? [
          BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
              redis: {
                host: configService.get('REDIS_HOST'),
                port: configService.get<number>('REDIS_PORT'),
              },
            }),
          }),
        ]
      : []),

    // ✅ SECURITY: Rate limiting (global)
    // Protects ALL endpoints by default
    // Individual routes can override with @Throttle() decorator
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // Time window: 60 seconds
        limit: 100, // Max 100 requests per window
      },
    ]),

    // Task Scheduling (for cron jobs, intervals, etc.)
    ScheduleModule.forRoot(),

    // Event Emitter (for pub/sub within the app)
    EventEmitterModule.forRoot(),

    // Feature Modules
    HealthModule, // Health checks
    UserModule, // User management
    AuthModule, // Authentication
    RoleModule, // RBAC (Roles & Permissions)
    ProfileModule, // User & Instructor profiles
    GroupModule, // Groups (fitness groups, training crews)
    SessionModule, // Training sessions
    InvitationModule, // Invitation management
    ClientModule, // Instructor-Client relationships
    BlogModule, // Blog posts + Cloudinary image uploads
    NotificationModule, // Notification system (Phase 1 — dummy/logger)
    AnalyticsModule, // Analytics & reporting
    FeedbackModule, // User feedback (bugs, suggestions)
    WaitlistModule, // Pre-launch waitlist signups
    PaymentModule, // Stripe Connect: onboarding, invoices, subscriptions, webhooks
  ],

  controllers: [],

  providers: [
    // ✅ SECURITY: Apply rate limiting globally
    // This makes ThrottlerGuard check every request
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // ✅ CONVENTION: Transform all response keys to camelCase
    // DB uses snake_case, API responses use camelCase
    {
      provide: APP_INTERCEPTOR,
      useClass: CamelCaseInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Configure Middleware
   *
   * Middleware runs BEFORE request reaches the route handler.
   * Order matters! They execute in the order you apply them.
   *
   * Here we apply RequestIdMiddleware to ALL routes (*).
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
