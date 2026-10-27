export const client = {
  inviteTargetRequired: 'Choose who to invite or enter their email.',
  coachesOnly: 'Only coaches can invite clients.',
  cannotInviteSelf: 'You cannot invite yourself as a client.',
  invitationAlreadyPending:
    'A pending invitation already exists for this email.',
  userNotFound: 'User not found.',
  alreadyYourClient: 'This user is already your client.',
  alreadyTheirClient: 'You are already a client of this coach.',
  requestAlreadyPending:
    'There is already a pending request or invitation between you and this person.',
  coachNotFound: 'Coach not found.',
  cannotRequestSelf: 'You cannot request to be your own client.',
  notACoach: 'This person is not a coach.',
  notAcceptingClients: 'This coach is not accepting new clients right now.',
  requestNotFound: 'Client request not found.',
  requestExpired: 'This request has expired.',
  requestAlreadyAnswered:
    'This request has already been {status, select, ACCEPTED {accepted} DECLINED {declined} CANCELLED {cancelled} other {answered}}.',
  cannotAcceptOthersRequest: 'You can only accept requests sent to you.',
  cannotDeclineOthersRequest: 'You can only decline requests sent to you.',
  cannotCancelOthersRequest: 'You can only cancel requests you sent.',
  invitationNotFound: 'Invitation not found.',
  invitationUsed: 'This invitation has already been used.',
  invitationExpired: 'This invitation has expired.',
  invitationAlreadyAnswered:
    'This invitation has already been {status, select, ACCEPTED {accepted} DECLINED {declined} CANCELLED {cancelled} other {used}}.',
  cannotResendAnswered:
    'Cannot resend an invitation that has already been {status, select, ACCEPTED {accepted} DECLINED {declined} CANCELLED {cancelled} other {answered}}.',
  clientNotFound: 'Client relationship not found.',
  notYourCoach: 'You are not a client of this coach.',
  importDailyLimit:
    '{remaining, plural, =0 {You cannot send more invitations today.} one {You can send # more invitation today.} other {You can send # more invitations today.}} Import fewer people or try again tomorrow.',
  alreadyLeftCoach: 'You have already stopped training with this coach.',
};
