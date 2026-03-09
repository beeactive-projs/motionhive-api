import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Session } from '../session/entities/session.entity';
import { SessionParticipant } from '../session/entities/session-participant.entity';
import { Group } from '../group/entities/group.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { User } from '../user/entities/user.entity';
import { RoleModule } from '../role/role.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Session,
      SessionParticipant,
      Group,
      GroupMember,
      InstructorClient,
      User,
    ]),
    RoleModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
