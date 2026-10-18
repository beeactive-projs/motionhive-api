export const group = {
  memberLeft: {
    title: 'A member left your group',
    body: '{name, select, null {A member} other {{name}}} left {group, select, null {your group} other {"{group}"}}.',
  },
  memberRemoved: {
    title: 'Removed from group',
    body: 'You\'ve been removed from {group, select, null {a group} other {"{group}"}}.',
  },
  closed: {
    title: 'A group was closed',
    body: '{group, select, null {A group you were in} other {"{group}"}} was closed because the person who ran it left MotionHive.',
  },
  joinRequestReceived: {
    title: 'New request to join your group',
    body: '{name, select, null {Someone} other {{name}}} requested to join{group, select, null {} other { "{group}"}}.',
  },
  joinRequestApproved: {
    title: 'Join request approved',
    body: 'You are now a member{group, select, null {} other { of "{group}"}}.',
  },
  joinRequestRejected: {
    title: 'Join request not approved',
    body: 'The owner declined your request{group, select, null {} other { to join "{group}"}}.',
  },
  ownershipReceived: {
    title: 'You are now the group owner',
    body: 'Ownership{group, select, null {} other { of "{group}"}} was transferred to you.',
  },
  ownershipTransferred: {
    title: 'Group ownership transferred',
    body: 'You transferred ownership{group, select, null {} other { of "{group}"}}.',
  },
  invitationReceived: {
    title: 'You were invited to a group',
    body: '{name, select, null {Someone} other {{name}}} invited you to join {group, select, null {a group} other {"{group}"}}.',
  },
  invitationAccepted: {
    title: 'Invitation accepted',
    body: '{name, select, null {A user} other {{name}}} accepted your invitation to {group, select, null {your group} other {"{group}"}}.',
  },
  invitationDeclined: {
    title: 'Invitation declined',
    body: '{name, select, null {A user} other {{name}}} declined your invitation to {group, select, null {your group} other {"{group}"}}.',
  },
  roleChanged: {
    title: 'Your group role changed',
    body: 'You are now {role, select, OWNER {an owner} MODERATOR {a moderator} other {a member}}{group, select, null {} other { in "{group}"}}.',
  },
};
