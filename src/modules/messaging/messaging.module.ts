import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { getJwtConfig } from '../../config/jwt.config';
import { Conversation } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { ConversationMembershipEvent } from './entities/conversation-membership-event.entity';
import { Message } from './entities/message.entity';
import { UserBlock } from './entities/user-block.entity';
import { MessageReport } from './entities/message-report.entity';
import { MessagingSuspension } from './entities/messaging-suspension.entity';
import { AdminMessageAccessLog } from './entities/admin-message-access-log.entity';
import { MessagingVelocityAlarm } from './entities/messaging-velocity-alarm.entity';
import { User } from '../user/entities/user.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { RoleModule } from '../role/role.module';
import { UserModule } from '../user/user.module';
import { MessagingController } from './messaging.controller';
import { MessagingAdminController } from './messaging-admin.controller';
import { MessagingSseController } from './messaging-sse.controller';
import { MessagingService } from './messaging.service';
import { MessagingSafetyService } from './messaging-safety.service';
import { MessagingModerationService } from './messaging-moderation.service';
import { MessagingContentService } from './messaging-content.service';
import { MessagingRateLimitService } from './messaging-rate-limit.service';
import { MessagingVelocityService } from './messaging-velocity.service';
import { MessagingEventsService } from './messaging-events.service';
import { MessagingStreamAckService } from './messaging-stream-ack.service';
import { SseJwtStrategy } from './auth/sse-jwt.strategy';
import { MessagingStreamTicketService } from './auth/messaging-stream-ticket.service';

/**
 * Messaging Module — Stage 1 skeleton.
 *
 * Registers the nine messaging entities with Sequelize and exposes the
 * body-helper seam on MessagingService. Controllers, safety service,
 * events, and SSE land in later stages.
 *
 * See docs/plans/messaging-backend-plan.md for the full plan.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Conversation,
      ConversationParticipant,
      ConversationMembershipEvent,
      Message,
      UserBlock,
      MessageReport,
      MessagingSuspension,
      AdminMessageAccessLog,
      MessagingVelocityAlarm,
      User,
      InstructorClient,
    ]),
    RoleModule,
    // UserModule exports UserService, used by SseJwtStrategy.validate
    // to resolve the user behind the query-param token.
    UserModule,
    // Registered here rather than importing AuthModule: this module needs
    // exactly one thing from it (a JwtService on the same secret, to sign
    // stream tickets), and AuthModule pulls in Profile and Payment.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getJwtConfig,
    }),
  ],
  controllers: [
    MessagingController,
    MessagingAdminController,
    MessagingSseController,
  ],
  providers: [
    MessagingService,
    MessagingSafetyService,
    MessagingModerationService,
    MessagingContentService,
    MessagingRateLimitService,
    MessagingVelocityService,
    MessagingEventsService,
    MessagingStreamAckService,
    MessagingStreamTicketService,
    SseJwtStrategy,
  ],
  exports: [
    MessagingService,
    MessagingSafetyService,
    MessagingModerationService,
    MessagingContentService,
    MessagingRateLimitService,
    MessagingVelocityService,
    MessagingEventsService,
  ],
})
export class MessagingModule {}
