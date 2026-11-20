import type { Catalog } from '../..';

export const session: Catalog['notifications']['session'] = {
  bookingConfirmed: {
    title: 'Rezervare confirmată',
    body: 'Ți-ai rezervat locul la „{title}” de {when}.',
  },
  bookingPending: {
    title: 'Rezervarea așteaptă aprobare',
    body: 'Rezervarea ta la „{title}” de {when} așteaptă aprobarea antrenorului.',
  },
  bookingWaitlisted: {
    title: 'Ești pe lista de așteptare',
    body: '„{title}” de {when} nu mai are locuri. Te anunțăm dacă se eliberează unul.',
  },
  bookingApproved: {
    title: 'Rezervare aprobată',
    body: 'Ai locul confirmat la „{title}” de {when}.',
  },
  bookingDeclined: {
    title: 'Rezervare refuzată',
    body: 'Rezervarea ta la „{title}” nu a fost aprobată.{reason, select, null {} other { Motiv: {reason}}}',
  },
  bookingDeclinedFull: {
    title: 'Rezervare refuzată',
    body: 'Rezervarea ta la „{title}” nu a fost aprobată, pentru că sesiunea nu mai are locuri.',
  },
  bookingPromoted: {
    title: 'Ai prins loc!',
    body: 'S-a eliberat un loc, așa că ai rezervarea confirmată la „{title}” de {when}.',
  },
  groupBookingsEnded: {
    title:
      '{count, plural, one {Rezervare anulată} few {Rezervări anulate} other {Rezervări anulate}}',
    body: '{count, plural, one {Nu mai faci parte din {group, select, null {grup} other {„{group}”}}, așa că rezervarea ta la sesiunea doar pentru membri a fost anulată.} few {Nu mai faci parte din {group, select, null {grup} other {„{group}”}}, așa că cele # rezervări ale tale la sesiunile doar pentru membri au fost anulate.} other {Nu mai faci parte din {group, select, null {grup} other {„{group}”}}, așa că cele # de rezervări ale tale la sesiunile doar pentru membri au fost anulate.}}',
  },
  groupDeletedBookingsEnded: {
    title:
      '{count, plural, one {Rezervare anulată} few {Rezervări anulate} other {Rezervări anulate}}',
    body: '{count, plural, one {{group, select, null {Un grup din care făceai parte} other {Grupul „{group}”}} a fost șters, așa că rezervarea ta la sesiunea grupului a fost anulată.} few {{group, select, null {Un grup din care făceai parte} other {Grupul „{group}”}} a fost șters, așa că cele # rezervări ale tale la sesiunile grupului au fost anulate.} other {{group, select, null {Un grup din care făceai parte} other {Grupul „{group}”}} a fost șters, așa că cele # de rezervări ale tale la sesiunile grupului au fost anulate.}}',
  },
  cancelled: {
    title: 'Sesiune anulată',
    body: '„{title}” de {when} a fost anulată.{reason, select, null {} other { Motiv: {reason}.}}{note, select, null {} other { „{note}”}}',
  },
  rescheduled: {
    title: 'Sesiune reprogramată',
    body: '„{title}” s-a mutat: în loc de {before}, are loc {after}.',
  },
  reminder24h: {
    title: 'Ai o sesiune mâine',
    body: '„{title}” începe {when}.',
  },
  reminder1h: {
    title: 'Sesiunea începe în curând',
    body: '„{title}” începe cam într-o oră ({when}).',
  },
  followUp: {
    title: 'Mesaj de la antrenorul tău după „{title}”',
    body: '{text}',
  },
  participantJoined: {
    title: 'Rezervare nouă',
    body: '{name, select, null {Cineva} other {{name}}} și-a rezervat loc la „{title}”.',
  },
  participantLeft: {
    title: 'Rezervare anulată',
    body: '{name, select, null {Cineva} other {{name}}} și-a anulat rezervarea la „{title}”.',
  },
};
