import type { NotifyParams } from '../notification/notification.service';
import { NotificationType } from '../notification/notification.service';

/**
 * Notification builders for the client (instructor↔client) module.
 *
 * Copy lives in the catalog (`notifications.client.*` under
 * src/common/i18n/catalog); builders only say which message and pass
 * the raw values. A missing name stays `null` here: the message decides
 * what to say instead, per language.
 *
 * Click targets:
 *   - Pending requests live at /coaching/pending-requests (instructor)
 *     and /profile (client; has no dedicated page).
 *   - Active relationships are visible from the instructor's clients
 *     page (/coaching/clients) and the client's profile (/profile).
 */

/** Instructor — a user has requested to be coached by them. */
export function clientRequestReceived(
  instructorId: string,
  requesterName: string | null,
): NotifyParams {
  return {
    userId: instructorId,
    type: NotificationType.CLIENT_REQUEST_RECEIVED,
    message: {
      key: 'client.requestReceived',
      params: { name: requesterName },
    },
    data: { screen: 'coaching/pending-requests' },
  };
}

/** Requester — the other side accepted them.
 *
 *  Both directions share this builder because `acceptRequest` handles
 *  CLIENT_TO_INSTRUCTOR and INSTRUCTOR_TO_CLIENT with the same code
 *  path and always notifies request.fromUserId. But the wording and the
 *  click target differ by role: a client landing on their coaches tab,
 *  an instructor landing on their clients list.
 */
export function clientRequestAccepted(
  requesterId: string,
  responderName: string | null,
  requesterIsInstructor = false,
): NotifyParams {
  return {
    userId: requesterId,
    type: NotificationType.CLIENT_REQUEST_ACCEPTED,
    message: {
      key: requesterIsInstructor
        ? 'client.invitationAccepted'
        : 'client.requestAccepted',
      params: { name: responderName },
    },
    data: requesterIsInstructor
      ? { screen: 'coaching/clients' }
      : { screen: 'profile', queryParams: { tab: 'coaches' } },
  };
}

/** Requester — the other side declined.
 *
 *  Same dual-recipient story as clientRequestAccepted — instructor
 *  invitations that get declined route back to the invite surface;
 *  client-side declined requests route to the coaches tab so they
 *  can look elsewhere.
 */
export function clientRequestDeclined(
  requesterId: string,
  responderName: string | null,
  requesterIsInstructor = false,
): NotifyParams {
  return {
    userId: requesterId,
    type: NotificationType.CLIENT_REQUEST_DECLINED,
    message: {
      key: requesterIsInstructor
        ? 'client.invitationDeclined'
        : 'client.requestDeclined',
      params: { name: responderName },
    },
    data: requesterIsInstructor
      ? { screen: 'coaching/clients' }
      : { screen: 'profile', queryParams: { tab: 'coaches' } },
  };
}

/** Invitee — instructor invited them to be a client. */
export function clientInvitationReceived(
  inviteeId: string,
  instructorName: string | null,
): NotifyParams {
  return {
    userId: inviteeId,
    type: NotificationType.CLIENT_INVITATION_RECEIVED,
    message: {
      key: 'client.invitationReceived',
      params: { name: instructorName },
    },
    data: { screen: 'profile', queryParams: { tab: 'coaches' } },
  };
}

/**
 * Client: their coach closed their MotionHive account. The plans the coach
 * assigned are copies, so they stay; the message says so. Lands on the
 * coaches tab, where the coach is no longer listed.
 */
export function coachLeftForClient(
  clientId: string,
  coachName: string | null,
): NotifyParams {
  return {
    userId: clientId,
    type: NotificationType.COACH_LEFT,
    message: { key: 'client.coachLeft', params: { name: coachName } },
    data: { screen: 'profile', queryParams: { tab: 'coaches' } },
  };
}

/** Instructor — client ended the coaching relationship. */
export function clientRelationshipEndedForInstructor(
  instructorId: string,
  clientName: string | null,
): NotifyParams {
  return {
    userId: instructorId,
    type: NotificationType.CLIENT_RELATIONSHIP_ENDED,
    message: {
      key: 'client.relationshipEnded',
      params: { name: clientName },
    },
    data: { screen: 'coaching/clients' },
  };
}
