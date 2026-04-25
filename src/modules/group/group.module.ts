import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Group } from './entities/group.entity';
import { GroupMember } from './entities/group-member.entity';
import { GroupController } from './group.controller';
import { GroupService } from './group.service';
import { RoleModule } from '../role/role.module';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { EmailService } from '../../common/services/email.service';
import { CryptoService } from '../../common/services/crypto.service';
import { SearchModule } from '../search/search.module';

/**
 * Group Module
 *
 * Manages groups, memberships, discovery, join links, and health data sharing consent.
 *
 * Dependencies:
 * - RoleModule: for role guards (INSTRUCTOR role check)
 * - InstructorClient: to flag which group members are clients of the instructor
 * - EmailService: for sending notifications (e.g. join confirmations)
 * - CryptoService: for generating/hashing join link tokens
 *
 * Exports GroupService so InvitationModule can add members.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Group, GroupMember, InstructorClient]),
    RoleModule,
    SearchModule,
  ],
  controllers: [GroupController],
  providers: [GroupService, EmailService, CryptoService],
  exports: [GroupService],
})
export class GroupModule {}
