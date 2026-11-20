import type { LoggerService } from '@nestjs/common';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';
import {
  GROUP_DELETED,
  GROUP_MEMBERSHIP_ENDED,
  type GroupMembershipEndedEvent,
} from '../group/group.events';
import type { SearchIndexService } from '../search/search-index.service';
import type { SessionBookingService } from './services/session-booking.service';
import type { SessionLifecycleService } from './services/session-lifecycle.service';
import { SessionGroupListener } from './session-group.listener';

/** The events a listener method is subscribed to (@nestjs/event-emitter metadata). */
function eventsOf(method: string): string[] {
  const handler = Object.getOwnPropertyDescriptor(
    SessionGroupListener.prototype,
    method,
  )?.value as object;
  const entries = Reflect.getMetadata('EVENT_LISTENER_METADATA', handler) as {
    event: string;
  }[];
  return entries.map((entry) => entry.event);
}

describe('SessionGroupListener', () => {
  const endGroupOnlyBookings = jest.fn<
    Promise<number>,
    [string, string, string]
  >();
  const cancelDeletedGroupSessions = jest.fn<
    Promise<{
      templateIds: string[];
      cancelledInstances: number;
      notifiedUserIds: string[];
    }>,
    [string, string]
  >();
  const upsertSession = jest.fn<Promise<void>, [string]>();
  const listener = new SessionGroupListener(
    { endGroupOnlyBookings } as unknown as SessionBookingService,
    { cancelDeletedGroupSessions } as unknown as SessionLifecycleService,
    { upsertSession } as unknown as SearchIndexService,
    makeSilentLogger() as unknown as LoggerService,
  );
  const ended: GroupMembershipEndedEvent = {
    groupId: 'group-1',
    groupName: 'Runners',
    userId: 'usr-member',
    reason: 'REMOVED',
  };

  beforeEach(() => {
    endGroupOnlyBookings.mockReset();
    cancelDeletedGroupSessions.mockReset();
    upsertSession.mockReset();
    upsertSession.mockResolvedValue(undefined);
  });

  it('listens for both group events', () => {
    expect(eventsOf('onMembershipEnded')).toContain(GROUP_MEMBERSHIP_ENDED);
    expect(eventsOf('onGroupDeleted')).toContain(GROUP_DELETED);
  });

  it('ends the person’s members-only bookings when their membership ends', async () => {
    endGroupOnlyBookings.mockResolvedValue(2);
    await expect(listener.onMembershipEnded(ended)).resolves.toBe(2);
    expect(endGroupOnlyBookings).toHaveBeenCalledWith(
      'group-1',
      'Runners',
      'usr-member',
    );
  });

  it('stops a deleted group’s members-only series and takes them out of search', async () => {
    cancelDeletedGroupSessions.mockResolvedValue({
      templateIds: ['tmpl-a', 'tmpl-b'],
      cancelledInstances: 5,
      notifiedUserIds: ['usr-a'],
    });
    upsertSession.mockRejectedValueOnce(new Error('search down'));

    await expect(
      listener.onGroupDeleted({ groupId: 'group-1', groupName: 'Runners' }),
    ).resolves.toBe(5);
    expect(cancelDeletedGroupSessions).toHaveBeenCalledWith(
      'group-1',
      'Runners',
    );
    expect(upsertSession.mock.calls).toEqual([['tmpl-a'], ['tmpl-b']]);
  });

  it('never throws back into the request that changed the group', async () => {
    endGroupOnlyBookings.mockRejectedValue(new Error('db down'));
    cancelDeletedGroupSessions.mockRejectedValue(new Error('db down'));
    await expect(listener.onMembershipEnded(ended)).resolves.toBe(0);
    await expect(
      listener.onGroupDeleted({ groupId: 'group-1', groupName: 'Runners' }),
    ).resolves.toBe(0);
  });
});
