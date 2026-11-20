import { forwardRef, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SessionTemplate } from './entities/session-template.entity';
import { SessionInstance } from './entities/session-instance.entity';
import { SessionParticipant } from './entities/session-participant.entity';
import { SessionReminderSchedule } from './entities/session-reminder-schedule.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { User } from '../user/entities/user.entity';
import { RecurrenceService } from './services/recurrence.service';
import { SessionTemplateService } from './services/session-template.service';
import { SessionInstanceService } from './services/session-instance.service';
import { SessionAccessService } from './services/session-access.service';
import { SessionBookingService } from './services/session-booking.service';
import { SessionWaitlistService } from './services/session-waitlist.service';
import { SessionConflictService } from './services/session-conflict.service';
import { SessionLifecycleService } from './services/session-lifecycle.service';
import { SessionReminderDispatchService } from './services/session-reminder-dispatch.service';
import { SessionDiscoverService } from './services/session-discover.service';
import { SessionDiscoverController } from './session-discover.controller';
import { SessionClientService } from './services/session-client.service';
import { SessionMyController } from './session-my.controller';
import { SessionTemplateController } from './session-template.controller';
import { SessionInstanceController } from './session-instance.controller';
import { SessionBookingController } from './session-booking.controller';
import { RoleModule } from '../role/role.module';
import { SearchModule } from '../search/search.module';
import { VenueModule } from '../venue/venue.module';
import { GroupModule } from '../group/group.module';

/**
 * Session Module
 *
 * Owns the session_template / session_instance / session_participant
 * surfaces. Imports VenueModule + GroupModule (forwardRef) so the
 * template service can validate `venueId` / `groupId` belongs to the
 * caller before persisting — prevents IDOR via cross-instructor refs.
 *
 * Group is imported via forwardRef because GroupModule already imports
 * SessionInstance/SessionTemplate at the entity level for its own
 * read paths.
 *
 * SequelizeModule.forFeature pulls in `InstructorClient` and
 * `GroupMember` *as model providers only* (no service dependency on
 * those modules) so `SessionAccessService` can check eligibility
 * without forcing a circular import on the client/group modules.
 */
import { SessionGroupListener } from './session-group.listener';

@Module({
  imports: [
    SequelizeModule.forFeature([
      SessionTemplate,
      SessionInstance,
      SessionParticipant,
      SessionReminderSchedule,
      InstructorClient,
      GroupMember,
      User,
    ]),
    RoleModule,
    VenueModule,
    SearchModule,
    forwardRef(() => GroupModule),
  ],
  controllers: [
    SessionTemplateController,
    SessionInstanceController,
    SessionBookingController,
    SessionDiscoverController,
    SessionMyController,
  ],
  providers: [
    RecurrenceService,
    SessionTemplateService,
    SessionInstanceService,
    SessionAccessService,
    SessionBookingService,
    SessionWaitlistService,
    SessionConflictService,
    SessionLifecycleService,
    SessionReminderDispatchService,
    SessionDiscoverService,
    SessionClientService,
    // Members-only bookings and series when a group membership ends or the group goes.
    SessionGroupListener,
  ],
  exports: [
    RecurrenceService,
    SessionTemplateService,
    SessionInstanceService,
    SessionAccessService,
    SessionBookingService,
    SessionWaitlistService,
    SessionConflictService,
    SessionLifecycleService,
    SessionReminderDispatchService,
    SessionDiscoverService,
    SessionClientService,
  ],
})
export class SessionModule {}
