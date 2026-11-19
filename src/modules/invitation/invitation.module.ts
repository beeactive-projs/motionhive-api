import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Invitation } from './entities/invitation.entity';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';
import { SocialInvitationController } from './social-invitation.controller';
import { SocialInvitationService } from './social-invitation.service';
import { GroupModule } from '../group/group.module';
import { GroupMember } from '../group/entities/group-member.entity';
import { RoleModule } from '../role/role.module';
import { User } from '../user/entities/user.entity';
import { CryptoService } from '../../common/services';
import { InstructorClient } from '../client/entities/instructor-client.entity';

/**
 * Invitation Module
 *
 * - Group invitations (existing: invitation entity + controller + service)
 * - Home-page "Invite a friend" / "Suggest an instructor" emails
 *   (stateless SocialInvitationController + Service — no DB row, the
 *   inviter's id rides in the signup URL as `?ref=`).
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Invitation,
      GroupMember,
      User,
      InstructorClient,
    ]),
    GroupModule,
    RoleModule,
  ],
  controllers: [InvitationController, SocialInvitationController],
  providers: [InvitationService, SocialInvitationService, CryptoService],
  exports: [InvitationService, SocialInvitationService],
})
export class InvitationModule {}
