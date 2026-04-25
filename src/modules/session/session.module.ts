import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Session } from './entities/session.entity';
import { SessionParticipant } from './entities/session-participant.entity';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { RoleModule } from '../role/role.module';
import { GroupMember } from '../group/entities/group-member.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { EmailService } from '../../common/services/email.service';
import { SearchModule } from '../search/search.module';

/**
 * Session Module
 *
 * Manages training sessions and participant registrations.
 * Depends on GroupMember entity for visibility checks.
 *
 * TODO: [JOB SYSTEM] When Bull/Redis is configured, add:
 * - SessionReminderJob: Send reminders X hours before session
 * - SessionStatusJob: Auto-transition SCHEDULED → IN_PROGRESS → COMPLETED
 * - RecurringSessionJob: Generate recurring session instances
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Session,
      SessionParticipant,
      GroupMember,
      InstructorClient,
    ]),
    RoleModule,
    SearchModule,
  ],
  controllers: [SessionController],
  providers: [SessionService, EmailService],
  exports: [SessionService],
})
export class SessionModule {}
