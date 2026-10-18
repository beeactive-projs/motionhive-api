import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';

import { CloudinaryService } from '../../common/services/cloudinary.service';
import { getJwtConfig } from '../../config/jwt.config';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { ClientModule } from '../client/client.module';
import { ClientRequest } from '../client/entities/client-request.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { GroupJoinRequest } from '../group/entities/group-join-request.entity';
import { Group } from '../group/entities/group.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { GroupModule } from '../group/group.module';
import { Invitation } from '../invitation/entities/invitation.entity';
import { MessagingModule } from '../messaging/messaging.module';
import { DeviceToken } from '../notification/entities/device-token.entity';
import { Dispute } from '../payment/entities/dispute.entity';
import { StripeCustomer } from '../payment/entities/stripe-customer.entity';
import { Subscription } from '../payment/entities/subscription.entity';
import { PaymentModule } from '../payment/payment.module';
import { SearchModule } from '../search/search.module';
import { SessionInstance } from '../session/entities/session-instance.entity';
import { SessionParticipant } from '../session/entities/session-participant.entity';
import { SessionTemplate } from '../session/entities/session-template.entity';
import { SessionModule } from '../session/session.module';
import { User } from '../user/entities/user.entity';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountErasureService } from './account-erasure.service';
import { AccountWindDownService } from './account-wind-down.service';
import { AccountDeletion } from './entities/account-deletion.entity';

/**
 * In-app account deletion: the request, the wind-down of everything shared
 * with other people, and the erasure within 30 days.
 *
 * Must not import AuthModule: AuthModule imports this one, to check every
 * sign-in. The restore ticket is signed with its own JwtModule on the same
 * secret (as MessagingModule does for stream tickets), and refresh tokens
 * are revoked through the model directly.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      AccountDeletion,
      User,
      RefreshToken,
      DeviceToken,
      Dispute,
      StripeCustomer,
      Subscription,
      SessionTemplate,
      SessionInstance,
      SessionParticipant,
      Group,
      GroupMember,
      GroupJoinRequest,
      Invitation,
      InstructorClient,
      ClientRequest,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getJwtConfig,
    }),
    PaymentModule,
    SessionModule,
    GroupModule,
    ClientModule,
    MessagingModule,
    SearchModule,
  ],
  controllers: [AccountDeletionController],
  providers: [
    AccountDeletionService,
    AccountWindDownService,
    AccountErasureService,
    CloudinaryService,
  ],
  exports: [AccountDeletionService, AccountErasureService],
})
export class AccountDeletionModule {}
