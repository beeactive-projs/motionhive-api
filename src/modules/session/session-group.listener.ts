import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import {
  GROUP_DELETED,
  GROUP_MEMBERSHIP_ENDED,
  type GroupDeletedEvent,
  type GroupMembershipEndedEvent,
} from '../group/group.events';
import { SearchIndexService } from '../search/search-index.service';
import { SessionBookingService } from './services/session-booking.service';
import { SessionLifecycleService } from './services/session-lifecycle.service';

/**
 * What sessions do when a group changes (group.events.ts). Lives here so
 * GroupModule needs no import of SessionModule. Never throws: the group
 * change has already been saved, and a failure here is logged, not turned
 * into an error for the request that made it.
 */
@Injectable()
export class SessionGroupListener {
  constructor(
    private readonly bookingService: SessionBookingService,
    private readonly lifecycleService: SessionLifecycleService,
    private readonly searchIndexService: SearchIndexService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /** Someone left or was removed: their members-only bookings there end. */
  @OnEvent(GROUP_MEMBERSHIP_ENDED)
  async onMembershipEnded(event: GroupMembershipEndedEvent): Promise<number> {
    try {
      return await this.bookingService.endGroupOnlyBookings(
        event.groupId,
        event.groupName,
        event.userId,
      );
    } catch (err) {
      this.logger.error(
        `[sessions] ending group-only bookings failed for user ${event.userId}, group ${event.groupId} (${event.reason}): ${(err as Error).message}`,
        'SessionGroupListener',
      );
      return 0;
    }
  }

  /**
   * The group was deleted: its members-only series stop, the people booked
   * are told, and the stopped series leave search (upsertSession drops a
   * series that is no longer ACTIVE).
   */
  @OnEvent(GROUP_DELETED)
  async onGroupDeleted(event: GroupDeletedEvent): Promise<number> {
    try {
      const { templateIds, cancelledInstances } =
        await this.lifecycleService.cancelDeletedGroupSessions(
          event.groupId,
          event.groupName,
        );
      for (const templateId of templateIds) {
        await this.searchIndexService
          .upsertSession(templateId)
          .catch((err: Error) =>
            this.logger.error(
              `[sessions] search update failed for series ${templateId}: ${err.message}`,
              'SessionGroupListener',
            ),
          );
      }
      return cancelledInstances;
    } catch (err) {
      this.logger.error(
        `[sessions] stopping the sessions of deleted group ${event.groupId} failed: ${(err as Error).message}`,
        'SessionGroupListener',
      );
      return 0;
    }
  }
}
