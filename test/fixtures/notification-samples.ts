import type { NotifyManyParams } from '../../src/modules/notification/notification.service';
import * as client from '../../src/modules/client/notifications';
import * as exercise from '../../src/modules/exercise/notifications';
import * as group from '../../src/modules/group/notifications';
import * as messaging from '../../src/modules/messaging/notifications';
import * as payment from '../../src/modules/payment/notifications';
import * as post from '../../src/modules/post/notifications';
import * as session from '../../src/modules/session/notifications';
import * as workout from '../../src/modules/workout/notifications';
import { GroupMemberRole } from '../../src/modules/group/entities/group-member.entity';

/**
 * Every notification the product sends, built with realistic values.
 *
 * Each entry is one wording a reader can see: a builder usually has a
 * typical case plus the cases where a value is missing or a count
 * changes the grammar. Specs run all of them in every language; the
 * same list feeds the copy-review sheet.
 */
export interface NotificationSample {
  /** Who receives it. */
  audience: 'client' | 'instructor' | 'group owner' | 'group member';
  /** What makes this wording different from the builder's typical one. */
  variant: string;
  build: () => NotifyManyParams;
}

const U = 'user-1';
const G = { id: 'group-1', name: 'Morning Runners' };
const G0 = { id: 'group-1', name: null };
const S: session.SessionRef = {
  id: 'inst-1',
  templateId: 'tpl-1',
  title: 'Pilates Flow',
  startAt: new Date('2026-06-15T15:00:00Z'),
  timezone: 'Europe/Bucharest',
};
const INV = {
  id: 'inv-1',
  number: 'INV-0042',
  amountDueCents: 25000,
  currency: 'ron',
  dueDate: '2026-06-30',
};
const POST = {
  groupId: 'group-1',
  groupName: 'Morning Runners',
  postId: 'p-1',
};
const POST0 = { ...POST, groupName: null };
const MSG = {
  recipientId: U,
  conversationId: 'conv-1',
  senderName: 'Ana Pop',
  preview: 'Ne vedem la 18:00?',
  suppressEmail: false,
  hidePreviewInEmail: false,
  muted: false,
};

export const NOTIFICATION_SAMPLES: NotificationSample[] = [
  // ── client ──
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => client.clientRequestReceived(U, 'Ana Pop'),
  },
  {
    audience: 'instructor',
    variant: 'no name',
    build: () => client.clientRequestReceived(U, null),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => client.clientRequestAccepted(U, 'Dan Ionescu'),
  },
  {
    audience: 'client',
    variant: 'no name',
    build: () => client.clientRequestAccepted(U, null),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => client.clientRequestAccepted(U, 'Ana Pop', true),
  },
  {
    audience: 'instructor',
    variant: 'no name',
    build: () => client.clientRequestAccepted(U, null, true),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => client.clientRequestDeclined(U, 'Dan Ionescu'),
  },
  {
    audience: 'client',
    variant: 'no name',
    build: () => client.clientRequestDeclined(U, null),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => client.clientRequestDeclined(U, 'Ana Pop', true),
  },
  {
    audience: 'instructor',
    variant: 'no name',
    build: () => client.clientRequestDeclined(U, null, true),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => client.clientInvitationReceived(U, 'Dan Ionescu'),
  },
  {
    audience: 'client',
    variant: 'no name',
    build: () => client.clientInvitationReceived(U, null),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => client.clientRelationshipEndedForInstructor(U, 'Ana Pop'),
  },
  {
    audience: 'instructor',
    variant: 'no name',
    build: () => client.clientRelationshipEndedForInstructor(U, null),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => client.coachLeftForClient(U, 'Dan Ionescu'),
  },
  {
    audience: 'client',
    variant: 'no name',
    build: () => client.coachLeftForClient(U, null),
  },

  // ── session ──
  {
    audience: 'client',
    variant: 'typical',
    build: () => session.sessionBookedForUser(U, S, { status: 'CONFIRMED' }),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () =>
      session.sessionBookedForUser(U, S, { status: 'PENDING_APPROVAL' }),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => session.sessionBookedForUser(U, S, { status: 'WAITLISTED' }),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => session.bookingApprovedForUser(U, S),
  },
  {
    audience: 'client',
    variant: "with the instructor's reason",
    build: () =>
      session.bookingDeclinedForUser(U, S, 'Grupa e doar pentru avansați'),
  },
  {
    audience: 'client',
    variant: 'no reason',
    build: () => session.bookingDeclinedForUser(U, S, null),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => session.bookingDeclinedSessionFullForUser(U, S),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => session.bookingPromotedForUser(U, S),
  },
  {
    audience: 'client',
    variant: 'with reason and note',
    build: () =>
      session.sessionCancelledForUser(
        U,
        S,
        'Sunt răcit',
        'Revin săptămâna viitoare',
      ),
  },
  {
    audience: 'client',
    variant: 'no reason, no note',
    build: () => session.sessionCancelledForUser(U, S, null, null),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () =>
      session.sessionRescheduledForUser(U, S, new Date('2026-06-14T15:00:00Z')),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => session.sessionReminderForUser(U, S, 'REMINDER_24H'),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => session.sessionReminderForUser(U, S, 'REMINDER_1H'),
  },
  {
    audience: 'client',
    variant: "the instructor's own text",
    build: () =>
      session.sessionFollowUpForUser(U, S, 'Bravo azi! Nu uita de stretching.'),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => session.participantJoinedForInstructor(U, 'Ana Pop', S),
  },
  {
    audience: 'instructor',
    variant: 'no name',
    build: () => session.participantJoinedForInstructor(U, null, S),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => session.participantLeftForInstructor(U, 'Ana Pop', S),
  },
  {
    audience: 'instructor',
    variant: 'no name',
    build: () => session.participantLeftForInstructor(U, null, S),
  },

  // ── payment ──
  {
    audience: 'client',
    variant: 'with due date',
    build: () => payment.invoiceCreatedForClient(U, INV),
  },
  {
    audience: 'client',
    variant: 'no due date',
    build: () => payment.invoiceCreatedForClient(U, { ...INV, dueDate: null }),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => payment.invoicePaidForInstructor(U, INV),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => payment.invoicePaidForClient(U, INV.id),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => payment.invoiceMarkedPaidForInstructor(U, INV),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => payment.invoicePaymentFailedForClient(U, INV.id),
  },
  {
    audience: 'client',
    variant: 'with due date',
    build: () => payment.invoiceDueSoonForClient(U, INV),
  },
  {
    audience: 'client',
    variant: 'no due date',
    build: () => payment.invoiceDueSoonForClient(U, { ...INV, dueDate: null }),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => payment.invoiceOverdueForClient(U, INV, '2026-07-01'),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => payment.invoiceOverdueForInstructor(U, INV, '2026-07-01'),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => payment.invoiceDunningForClient(U, INV.id, '2026-07-01'),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => payment.subscriptionCreatedForClient(U, 'Abonament lunar'),
  },
  {
    audience: 'client',
    variant: 'with plan name',
    build: () =>
      payment.subscriptionCancelledForClient(U, 'Abonament lunar', true),
  },
  {
    audience: 'client',
    variant: 'no plan name',
    build: () => payment.subscriptionCancelledForClient(U, null, true),
  },
  {
    audience: 'client',
    variant: 'with plan name',
    build: () =>
      payment.subscriptionCancelledForClient(U, 'Abonament lunar', false),
  },
  {
    audience: 'client',
    variant: 'no plan name',
    build: () => payment.subscriptionCancelledForClient(U, null, false),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () =>
      payment.subscriptionCancelledByClientForInstructor(
        U,
        'sub-1',
        'Ana Pop',
        'Abonament lunar',
      ),
  },
  {
    audience: 'instructor',
    variant: 'no name, no plan name',
    build: () =>
      payment.subscriptionCancelledByClientForInstructor(
        U,
        'sub-1',
        null,
        null,
      ),
  },
  {
    audience: 'client',
    variant: 'typical',
    build: () => payment.refundIssuedForClient(U, 25000, 'ron', INV.id),
  },
  {
    audience: 'instructor',
    variant: '1 day left',
    build: () =>
      payment.refundWindowClosingForInstructor(U, {
        id: 'pay-1',
        invoiceId: INV.id,
        amountCents: 25000,
        currency: 'ron',
        daysLeft: 1,
      }),
  },
  {
    audience: 'instructor',
    variant: '2 days left',
    build: () =>
      payment.refundWindowClosingForInstructor(U, {
        id: 'pay-1',
        invoiceId: INV.id,
        amountCents: 25000,
        currency: 'ron',
        daysLeft: 2,
      }),
  },
  {
    audience: 'client',
    variant: 'with card digits',
    build: () =>
      payment.cardExpiringForClient(U, {
        brand: 'visa',
        last4: '4242',
        expMonth: 7,
        expYear: 2026,
      }),
  },
  {
    audience: 'client',
    variant: 'no card digits',
    build: () =>
      payment.cardExpiringForClient(U, {
        brand: null,
        last4: null,
        expMonth: 7,
        expYear: 2026,
      }),
  },
  {
    audience: 'instructor',
    variant: '1 payment',
    build: () =>
      payment.earningsSummaryForInstructor(U, {
        month: '2026-05',
        monthKey: '2026-05:ron',
        grossCents: 25000,
        currency: 'ron',
        paymentCount: 1,
      }),
  },
  {
    audience: 'instructor',
    variant: '3 payments',
    build: () =>
      payment.earningsSummaryForInstructor(U, {
        month: '2026-05',
        monthKey: '2026-05:ron',
        grossCents: 75000,
        currency: 'ron',
        paymentCount: 3,
      }),
  },
  {
    audience: 'instructor',
    variant: '25 payments',
    build: () =>
      payment.earningsSummaryForInstructor(U, {
        month: '2026-05',
        monthKey: '2026-05:ron',
        grossCents: 625000,
        currency: 'ron',
        paymentCount: 25,
      }),
  },
  {
    audience: 'instructor',
    variant: 'with reason and deadline',
    build: () =>
      payment.disputeOpenedForInstructor(U, {
        id: 'dp-1',
        amountCents: 25000,
        currency: 'ron',
        reason: 'fraudulent',
        evidenceDueBy: '2026-07-10',
      }),
  },
  {
    audience: 'instructor',
    variant: 'no reason, no deadline',
    build: () =>
      payment.disputeOpenedForInstructor(U, {
        id: 'dp-1',
        amountCents: 25000,
        currency: 'ron',
        reason: null,
        evidenceDueBy: null,
      }),
  },
  {
    audience: 'instructor',
    variant: '3 days left',
    build: () =>
      payment.disputeEvidenceDueForInstructor(U, {
        id: 'dp-1',
        evidenceDueBy: '2026-07-10',
        daysLeft: 3,
        bucket: 't3',
      }),
  },
  {
    audience: 'instructor',
    variant: '1 day left',
    build: () =>
      payment.disputeEvidenceDueForInstructor(U, {
        id: 'dp-1',
        evidenceDueBy: '2026-07-10',
        daysLeft: 1,
        bucket: 't1',
      }),
  },
  {
    audience: 'instructor',
    variant: 'no deadline date',
    build: () =>
      payment.disputeEvidenceDueForInstructor(U, {
        id: 'dp-1',
        evidenceDueBy: null,
        daysLeft: 3,
        bucket: 't3',
      }),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => payment.stripeAccountReadyForInstructor(U),
  },
  {
    audience: 'instructor',
    variant: 'typical',
    build: () => payment.stripeAccountRestrictedForInstructor(U),
  },
  {
    audience: 'instructor',
    variant: 'no active subscriptions',
    build: () => payment.stripeAccountDisconnectedForInstructor(U, 0),
  },
  {
    audience: 'instructor',
    variant: '1 active subscription',
    build: () => payment.stripeAccountDisconnectedForInstructor(U, 1),
  },
  {
    audience: 'instructor',
    variant: '3 active subscriptions',
    build: () => payment.stripeAccountDisconnectedForInstructor(U, 3),
  },
  {
    audience: 'instructor',
    variant: '25 active subscriptions',
    build: () => payment.stripeAccountDisconnectedForInstructor(U, 25),
  },

  // ── group ──
  {
    audience: 'group owner',
    variant: 'typical',
    build: () => group.groupMemberLeft(U, G, 'Ana Pop'),
  },
  {
    audience: 'group owner',
    variant: 'no name, no group name',
    build: () => group.groupMemberLeft(U, G0, null),
  },
  {
    audience: 'group member',
    variant: 'typical',
    build: () => group.groupMemberRemoved(U, G),
  },
  {
    audience: 'group member',
    variant: 'no group name',
    build: () => group.groupMemberRemoved(U, G0),
  },
  {
    audience: 'group member',
    variant: 'typical',
    build: () => group.groupClosedForMembers(G),
  },
  {
    audience: 'group member',
    variant: 'no group name',
    build: () => group.groupClosedForMembers(G0),
  },
  {
    audience: 'group owner',
    variant: 'typical',
    build: () => group.groupJoinRequestReceived(U, G, 'Ana Pop'),
  },
  {
    audience: 'group owner',
    variant: 'no name, no group name',
    build: () => group.groupJoinRequestReceived(U, G0, null),
  },
  {
    audience: 'group member',
    variant: 'typical',
    build: () => group.groupJoinRequestApproved(U, G),
  },
  {
    audience: 'group member',
    variant: 'no group name',
    build: () => group.groupJoinRequestApproved(U, G0),
  },
  {
    audience: 'group member',
    variant: 'typical',
    build: () => group.groupJoinRequestRejected(U, G),
  },
  {
    audience: 'group member',
    variant: 'no group name',
    build: () => group.groupJoinRequestRejected(U, G0),
  },
  {
    audience: 'group owner',
    variant: 'typical',
    build: () => group.groupOwnershipTransferredToNewOwner(U, G),
  },
  {
    audience: 'group owner',
    variant: 'no group name',
    build: () => group.groupOwnershipTransferredToNewOwner(U, G0),
  },
  {
    audience: 'group member',
    variant: 'typical',
    build: () => group.groupOwnershipTransferredFromOldOwner(U, G),
  },
  {
    audience: 'group member',
    variant: 'no group name',
    build: () => group.groupOwnershipTransferredFromOldOwner(U, G0),
  },
  {
    audience: 'group member',
    variant: 'typical',
    build: () => group.groupInvitationReceived(U, G, 'Dan Ionescu'),
  },
  {
    audience: 'group member',
    variant: 'no name, no group name',
    build: () => group.groupInvitationReceived(U, G0, null),
  },
  {
    audience: 'group owner',
    variant: 'typical',
    build: () => group.groupInvitationAccepted(U, G, 'Ana Pop'),
  },
  {
    audience: 'group owner',
    variant: 'no name, no group name',
    build: () => group.groupInvitationAccepted(U, G0, null),
  },
  {
    audience: 'group owner',
    variant: 'typical',
    build: () => group.groupInvitationDeclined(U, G, 'Ana Pop'),
  },
  {
    audience: 'group owner',
    variant: 'no name, no group name',
    build: () => group.groupInvitationDeclined(U, G0, null),
  },
  {
    audience: 'group member',
    variant: 'now moderator',
    build: () => group.groupMemberRoleChanged(U, G, GroupMemberRole.MODERATOR),
  },
  {
    audience: 'group member',
    variant: 'now owner',
    build: () => group.groupMemberRoleChanged(U, G, GroupMemberRole.OWNER),
  },
  {
    audience: 'group member',
    variant: 'now member, no group name',
    build: () => group.groupMemberRoleChanged(U, G0, GroupMemberRole.MEMBER),
  },

  // ── post ──
  {
    audience: 'group owner',
    variant: 'typical',
    build: () => post.postPendingApproval(POST, 'Ana Pop'),
  },
  {
    audience: 'group owner',
    variant: 'no name, no group name',
    build: () => post.postPendingApproval(POST0, null),
  },
  {
    audience: 'group member',
    variant: 'typical',
    build: () => post.postApprovedForAuthor(U, POST),
  },
  {
    audience: 'group member',
    variant: 'no group name',
    build: () => post.postApprovedForAuthor(U, POST0),
  },
  {
    audience: 'group member',
    variant: 'typical',
    build: () => post.postRejectedForAuthor(U, POST),
  },
  {
    audience: 'group member',
    variant: 'no group name',
    build: () => post.postRejectedForAuthor(U, POST0),
  },
  {
    audience: 'group member',
    variant: 'typical',
    build: () => post.postNewComment(U, POST, 'Ana Pop'),
  },
  {
    audience: 'group member',
    variant: 'no name, no group name',
    build: () => post.postNewComment(U, POST0, null),
  },

  // ── workout ──
  {
    audience: 'client',
    variant: 'typical',
    build: () =>
      workout.programAssignedForClient({
        clientId: U,
        assignmentId: 'a-1',
        programName: 'Forță 8 săptămâni',
        startDate: '2026-06-22',
        instructorName: 'Dan Ionescu',
      }),
  },
  {
    audience: 'instructor',
    variant: '1 set',
    build: () =>
      workout.clientCompletedWorkoutForInstructor({
        instructorId: U,
        clientId: 'c-1',
        workoutLogId: 'l-1',
        clientName: 'Ana Pop',
        workoutName: 'Ziua 1: Picioare',
        setsCompleted: 1,
      }),
  },
  {
    audience: 'instructor',
    variant: '12 sets',
    build: () =>
      workout.clientCompletedWorkoutForInstructor({
        instructorId: U,
        clientId: 'c-1',
        workoutLogId: 'l-1',
        clientName: 'Ana Pop',
        workoutName: 'Ziua 1: Picioare',
        setsCompleted: 12,
      }),
  },
  {
    audience: 'instructor',
    variant: '24 sets',
    build: () =>
      workout.clientCompletedWorkoutForInstructor({
        instructorId: U,
        clientId: 'c-1',
        workoutLogId: 'l-1',
        clientName: 'Ana Pop',
        workoutName: 'Ziua 1: Picioare',
        setsCompleted: 24,
      }),
  },
  {
    audience: 'instructor',
    variant: '1 workout',
    build: () =>
      workout.clientCompletedPlanForInstructor({
        instructorId: U,
        clientId: 'c-1',
        clientName: 'Ana Pop',
        programName: 'Forță 8 săptămâni',
        workoutsCompleted: 1,
      }),
  },
  {
    audience: 'instructor',
    variant: '12 workouts',
    build: () =>
      workout.clientCompletedPlanForInstructor({
        instructorId: U,
        clientId: 'c-1',
        clientName: 'Ana Pop',
        programName: 'Forță 8 săptămâni',
        workoutsCompleted: 12,
      }),
  },
  {
    audience: 'instructor',
    variant: '24 workouts',
    build: () =>
      workout.clientCompletedPlanForInstructor({
        instructorId: U,
        clientId: 'c-1',
        clientName: 'Ana Pop',
        programName: 'Forță 8 săptămâni',
        workoutsCompleted: 24,
      }),
  },
  {
    audience: 'client',
    variant: 'sexual content',
    build: () =>
      workout.workoutTakenDownForOwner({
        ownerId: U,
        workoutLogId: 'l-1',
        workoutName: 'Ziua 1: Picioare',
        category: 'SEXUAL',
      }),
  },
  {
    audience: 'client',
    variant: 'other reason',
    build: () =>
      workout.workoutTakenDownForOwner({
        ownerId: U,
        workoutLogId: 'l-1',
        workoutName: 'Ziua 1: Picioare',
        category: 'OTHER',
      }),
  },

  // ── messaging ──
  {
    audience: 'client',
    variant: 'typical',
    build: () => messaging.messageReceived(MSG),
  },
  {
    audience: 'client',
    variant: 'no name',
    build: () => messaging.messageReceived({ ...MSG, senderName: null }),
  },
  {
    audience: 'client',
    variant: 'previews hidden',
    build: () =>
      messaging.messageReceived({ ...MSG, hidePreviewInEmail: true }),
  },
  {
    audience: 'client',
    variant: 'previews hidden, no name',
    build: () =>
      messaging.messageReceived({
        ...MSG,
        senderName: null,
        hidePreviewInEmail: true,
      }),
  },

  // ── exercise ──
  {
    audience: 'instructor',
    variant: '1 copy',
    build: () =>
      exercise.exerciseForkedForOwner({
        ownerId: U,
        exerciseId: 'e-1',
        exerciseName: 'Genuflexiuni bulgărești',
        forkedByName: 'Dan Ionescu',
        newForkCount: 1,
      }),
  },
  {
    audience: 'instructor',
    variant: '3 copies',
    build: () =>
      exercise.exerciseForkedForOwner({
        ownerId: U,
        exerciseId: 'e-1',
        exerciseName: 'Genuflexiuni bulgărești',
        forkedByName: 'Dan Ionescu',
        newForkCount: 3,
      }),
  },
  {
    audience: 'instructor',
    variant: '25 copies',
    build: () =>
      exercise.exerciseForkedForOwner({
        ownerId: U,
        exerciseId: 'e-1',
        exerciseName: 'Genuflexiuni bulgărești',
        forkedByName: 'Dan Ionescu',
        newForkCount: 25,
      }),
  },
];
