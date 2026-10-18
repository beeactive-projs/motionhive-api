import type { Catalog } from '../..';

export const client: Catalog['notifications']['client'] = {
  requestReceived: {
    title: 'Cerere nouă',
    body: '{name, select, null {Cineva} other {{name}}} vrea să se antreneze sub îndrumarea ta.',
  },
  requestAccepted: {
    title: 'Cererea ta a fost acceptată',
    body: '{name, select, null {Antrenorul tău} other {{name}}} a acceptat să te antreneze.',
  },
  requestDeclined: {
    title: 'Cererea ta a fost refuzată',
    body: '{name, select, null {Antrenorul} other {{name}}} nu ți-a acceptat cererea.',
  },
  invitationReceived: {
    title: 'Invitație de la un antrenor',
    body: '{name, select, null {Un antrenor} other {{name}}} îți propune să te antreneze.',
  },
  invitationAccepted: {
    title: 'Invitație acceptată',
    body: '{name, select, null {Cineva} other {{name}}} ți-a acceptat invitația și face parte acum dintre clienții tăi.',
  },
  invitationDeclined: {
    title: 'Invitație refuzată',
    body: '{name, select, null {Cineva} other {{name}}} ți-a refuzat invitația.',
  },
  relationshipEnded: {
    title: 'Un client a renunțat',
    body: '{name, select, null {Un client} other {{name}}} nu se mai antrenează cu tine.',
  },
  coachLeft: {
    title: 'Antrenorul tău a părăsit MotionHive',
    body: '{name, select, null {Antrenorul tău} other {{name}}} și-a închis contul MotionHive. Planurile primite rămân în contul tău.',
  },
};
