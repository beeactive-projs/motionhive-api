import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getDatabaseConfig } from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import { createLogger } from './common/logger/winston.config';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestTimingMiddleware } from './common/middleware/request-timing.middleware';
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
import { EmailModule } from './common/services/email.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';
import { PaymentModule } from './modules/payment/payment.module';
import { VenueModule } from './modules/venue/venue.module';
import { ExerciseModule } from './modules/exercise/exercise.module';
import { WorkoutModule } from './modules/workout/workout.module';
import { SearchModule } from './modules/search/search.module';
import { PostModule } from './modules/post/post.module';
import { ProgressModule } from './modules/progress/progress.module';
import { ReviewModule } from './modules/review/review.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { AdminModule } from './modules/admin/admin.module';
import { CamelCaseInterceptor } from './common/interceptors/camel-case.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    WinstonModule.forRootAsync({
      useFactory: () => createLogger(),
    }),

    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getDatabaseConfig,
    }),

    // BullMQ only when REDIS_HOST is set — lets devs boot without
    // Redis. JobsService falls back to no-op + warn log. Production
    // env validation requires REDIS_HOST.
    ...(process.env.REDIS_HOST
      ? [
          BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
              connection: {
                host: configService.get<string>('REDIS_HOST'),
                port: configService.get<number>('REDIS_PORT'),
                password: configService.get<string>('REDIS_PASSWORD'),
                // Empty object (not `true`) keeps rejectUnauthorized
                // at its default — managed providers (Redis Cloud)
                // reject unverified certs otherwise.
                tls:
                  configService.get<string>('REDIS_TLS') === 'true'
                    ? {}
                    : undefined,
              },
            }),
          }),
        ]
      : []),

    // A ceiling per route per user (see UserThrottlerGuard), not a policy:
    // a person by hand peaks at ~10/min on any one route, so 300 only ever
    // catches a runaway loop or a bot. The security limits are the
    // per-route @Throttle()s on auth, payments and the email-sending routes.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 300 }]),

    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),

    EmailModule,

    HealthModule,
    UserModule,
    AuthModule,
    RoleModule,
    ProfileModule,
    GroupModule,
    SessionModule,
    InvitationModule,
    ClientModule,
    BlogModule,
    NotificationModule,
    JobsModule.register(),
    AnalyticsModule,
    FeedbackModule,
    WaitlistModule,
    PaymentModule,
    VenueModule,
    ExerciseModule,
    WorkoutModule,
    SearchModule,
    PostModule,
    ProgressModule,
    ReviewModule,
    MessagingModule,
    AdminModule,
  ],

  controllers: [],

  providers: [
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: CamelCaseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Order matters: the timing log line carries the request id.
    consumer.apply(RequestIdMiddleware, RequestTimingMiddleware).forRoutes('*');
  }
}
