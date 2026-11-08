import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Group } from './entities/group.entity';
import { GroupMember } from './entities/group-member.entity';
import { GroupJoinRequest } from './entities/group-join-request.entity';
import { GroupCategory } from './entities/group-category.entity';
import { User } from '../user/entities/user.entity';
import { SessionInstance } from '../session/entities/session-instance.entity';
import { SessionTemplate } from '../session/entities/session-template.entity';
import { GroupController } from './group.controller';
import { GroupService } from './group.service';
import { RoleModule } from '../role/role.module';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { CryptoService } from '../../common/services/crypto.service';
import { SearchModule } from '../search/search.module';
import { CategoryModule } from '../category/category.module';

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
 * - CategoryModule: checks the categories an owner picks for their group
 *
 * Exports GroupService so InvitationModule can add members.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Group,
      GroupMember,
      GroupJoinRequest,
      GroupCategory,
      InstructorClient,
      User,
      SessionInstance,
      SessionTemplate,
    ]),
    RoleModule,
    SearchModule,
    CategoryModule,
  ],
  controllers: [GroupController],
  providers: [GroupService, CryptoService],
  exports: [GroupService],
})
export class GroupModule {}
