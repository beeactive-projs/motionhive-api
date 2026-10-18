export const client = {
  requestReceived: {
    title: 'New coaching request',
    body: '{name, select, null {A user} other {{name}}} would like to work with you.',
  },
  requestAccepted: {
    title: 'Coaching request accepted',
    body: '{name, select, null {Your instructor} other {{name}}} accepted your coaching request.',
  },
  requestDeclined: {
    title: 'Coaching request declined',
    body: '{name, select, null {The instructor} other {{name}}} declined your coaching request.',
  },
  invitationReceived: {
    title: 'Coaching invitation',
    body: '{name, select, null {An instructor} other {{name}}} invited you to become their client.',
  },
  invitationAccepted: {
    title: 'Invitation accepted',
    body: '{name, select, null {A user} other {{name}}} accepted your invitation and is now your client.',
  },
  invitationDeclined: {
    title: 'Invitation declined',
    body: '{name, select, null {The user} other {{name}}} declined your coaching invitation.',
  },
  relationshipEnded: {
    title: 'Coaching ended',
    body: '{name, select, null {A client} other {{name}}} ended the coaching relationship.',
  },
  coachLeft: {
    title: 'Your coach left MotionHive',
    body: '{name, select, null {Your coach} other {{name}}} closed their MotionHive account. The plans they gave you stay in your account.',
  },
};
