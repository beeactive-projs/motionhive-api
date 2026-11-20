/**
 * Events GroupService announces on the app's EventEmitter2 bus, so other
 * modules can react without GroupModule importing them (SessionModule
 * already imports GroupModule; the other way round would be a cycle).
 * GroupService awaits them with `emitAsync`, after its own write.
 */

/** Someone stopped being a member: removed by the owner, or left. */
export const GROUP_MEMBERSHIP_ENDED = 'group.membership.ended';

export interface GroupMembershipEndedEvent {
  groupId: string;
  groupName: string;
  userId: string;
  reason: 'REMOVED' | 'LEFT';
}

/** The owner deleted the group (after its rows and memberships ended). */
export const GROUP_DELETED = 'group.deleted';

export interface GroupDeletedEvent {
  groupId: string;
  groupName: string;
}
