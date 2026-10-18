import type {
  NotifyManyParams,
  NotifyParams,
} from '../notification/notification.service';
import { NotificationType } from '../notification/notification.service';
import { GroupMemberRole } from './entities/group-member.entity';

/**
 * Notification builders for the group module.
 *
 * Copy lives in the catalog (`notifications.group.*` under
 * src/common/i18n/catalog). A missing person or group name is passed as
 * `null`; the message words that case itself, per language.
 *
 * Click-target rule: the FE detail route is `/groups/:id` (not
 * `group-detail`), and the list is `/groups`. When the recipient is
 * still a member, we deep-link to the group; when they've been
 * removed, we send them to the list (no entityId) so they don't get
 * 403'd by the group's access guard.
 */

interface GroupRef {
  id: string;
  name: string | null;
}

/**
 * Group owner — a member voluntarily left the group. Distinct from
 * `groupMemberRemoved` (which targets the removed user). Informational
 * only; the owner doesn't need to act.
 */
export function groupMemberLeft(
  ownerId: string,
  group: GroupRef,
  memberName: string | null,
): NotifyParams {
  return {
    userId: ownerId,
    type: NotificationType.GROUP_MEMBER_LEFT,
    message: {
      key: 'group.memberLeft',
      params: { name: memberName, group: group.name },
    },
    data: { screen: 'groups', entityId: group.id },
  };
}

/**
 * Members: the group closed because its owner closed their account. The
 * group is gone, so this lands on the list.
 *
 * Returns `NotifyManyParams` (no `userId`): the caller fans out to every
 * member at once via notifyMany.
 */
export function groupClosedForMembers(group: GroupRef): NotifyManyParams {
  return {
    type: NotificationType.GROUP_CLOSED,
    message: { key: 'group.closed', params: { group: group.name } },
    data: { screen: 'groups' },
  };
}

/** Member was removed from the group — they no longer have access. */
export function groupMemberRemoved(
  removedUserId: string,
  group: GroupRef,
): NotifyParams {
  return {
    userId: removedUserId,
    type: NotificationType.GROUP_MEMBER_REMOVED,
    message: { key: 'group.memberRemoved', params: { group: group.name } },
    // No entityId: the user can no longer access /groups/<id>. Land
    // on the list instead.
    data: { screen: 'groups' },
  };
}

/** Owner — someone requested to join their group. */
export function groupJoinRequestReceived(
  ownerId: string,
  group: GroupRef,
  requesterName: string | null,
): NotifyParams {
  return {
    userId: ownerId,
    type: NotificationType.GROUP_JOIN_REQUEST_RECEIVED,
    message: {
      key: 'group.joinRequestReceived',
      params: { name: requesterName, group: group.name },
    },
    data: { screen: 'groups', entityId: group.id },
  };
}

/** Requester — owner approved their join request. */
export function groupJoinRequestApproved(
  requesterId: string,
  group: GroupRef,
): NotifyParams {
  return {
    userId: requesterId,
    type: NotificationType.GROUP_JOIN_REQUEST_APPROVED,
    message: {
      key: 'group.joinRequestApproved',
      params: { group: group.name },
    },
    data: { screen: 'groups', entityId: group.id },
  };
}

/** Requester — owner rejected their join request. */
export function groupJoinRequestRejected(
  requesterId: string,
  group: GroupRef,
): NotifyParams {
  return {
    userId: requesterId,
    type: NotificationType.GROUP_JOIN_REQUEST_REJECTED,
    message: {
      key: 'group.joinRequestRejected',
      params: { group: group.name },
    },
    // The user isn't a member, so /groups/<id> may 403 depending on
    // visibility. Land them on the list.
    data: { screen: 'groups' },
  };
}

/** New owner — ownership was transferred to them. */
export function groupOwnershipTransferredToNewOwner(
  newOwnerId: string,
  group: GroupRef,
): NotifyParams {
  return {
    userId: newOwnerId,
    type: NotificationType.GROUP_OWNERSHIP_TRANSFERRED,
    message: {
      key: 'group.ownershipReceived',
      params: { group: group.name },
    },
    data: { screen: 'groups', entityId: group.id },
  };
}

/** Old owner — they handed ownership over. */
export function groupOwnershipTransferredFromOldOwner(
  oldOwnerId: string,
  group: GroupRef,
): NotifyParams {
  return {
    userId: oldOwnerId,
    type: NotificationType.GROUP_OWNERSHIP_TRANSFERRED,
    message: {
      key: 'group.ownershipTransferred',
      params: { group: group.name },
    },
    data: { screen: 'groups', entityId: group.id },
  };
}

/** Invitee — someone invited them to join a group. */
export function groupInvitationReceived(
  inviteeUserId: string,
  group: GroupRef,
  inviterName: string | null,
): NotifyParams {
  return {
    userId: inviteeUserId,
    type: NotificationType.GROUP_INVITATION_RECEIVED,
    message: {
      key: 'group.invitationReceived',
      params: { name: inviterName, group: group.name },
    },
    // No entityId until they accept — they may not yet have access.
    data: { screen: 'groups' },
  };
}

/** Owner — invitee accepted the invitation. */
export function groupInvitationAccepted(
  ownerId: string,
  group: GroupRef,
  inviteeName: string | null,
): NotifyParams {
  return {
    userId: ownerId,
    type: NotificationType.GROUP_INVITATION_ACCEPTED,
    message: {
      key: 'group.invitationAccepted',
      params: { name: inviteeName, group: group.name },
    },
    data: { screen: 'groups', entityId: group.id },
  };
}

/** Owner — invitee declined the invitation. */
export function groupInvitationDeclined(
  ownerId: string,
  group: GroupRef,
  inviteeName: string | null,
): NotifyParams {
  return {
    userId: ownerId,
    type: NotificationType.GROUP_INVITATION_DECLINED,
    message: {
      key: 'group.invitationDeclined',
      params: { name: inviteeName, group: group.name },
    },
    data: { screen: 'groups', entityId: group.id },
  };
}

/**
 * Member — their role within the group changed. The role travels as the
 * raw enum value; the message maps it to a word per language (and falls
 * back to "member" for a value it does not know).
 */
export function groupMemberRoleChanged(
  memberUserId: string,
  group: GroupRef,
  newRole: GroupMemberRole,
): NotifyParams {
  return {
    userId: memberUserId,
    type: NotificationType.GROUP_MEMBER_ROLE_CHANGED,
    message: {
      key: 'group.roleChanged',
      params: { role: newRole, group: group.name },
    },
    data: { screen: 'groups', entityId: group.id },
  };
}
