import type { Catalog } from '../..';

export const session: Catalog['errors']['session'] = {
  notFound: 'Nu am găsit sesiunea.',

  cannotBookOwn: 'Nu poți rezerva un loc la propria sesiune.',
  seriesNotActive: 'Seria de sesiuni nu mai este activă.',
  notBookable: 'Sesiunea nu mai acceptă rezervări.',
  alreadyStarted: 'Sesiunea a început deja.',
  notEligible: 'Nu poți rezerva această sesiune.',
  alreadyBooked:
    '{status, select, WAITLISTED {Ești deja pe lista de așteptare pentru această sesiune.} PENDING_APPROVAL {Ai cerut deja un loc la această sesiune. Antrenorul nu a răspuns încă.} other {Ai deja o rezervare la această sesiune.}}',
  full: 'Sesiunea nu mai are locuri libere.',
  notActive: 'Sesiunea nu mai este activă.',
  bookingNotFound: 'Nu am găsit rezervarea.',
  bookingAlreadyEnded: 'Rezervarea a fost deja anulată sau refuzată.',
  joinConfirmedOnly:
    'Doar participanții cu rezervare confirmată pot intra în această sesiune.',
  noMeetingLink: 'Sesiunea nu are un link de întâlnire.',

  pendingParticipantNotFound: 'Nu am găsit cererea de rezervare.',
  participantNotFound: 'Nu am găsit participantul.',
  attendanceConfirmedOnly:
    'Doar persoanele cu loc confirmat pot fi marcate ca prezente.',
  attendanceBeforeStart: 'Poți marca prezența doar după ce începe sesiunea.',

  invalidTimezone: 'Alege un fus orar valid.',
  startInPast: 'Alege o oră de început din viitor.',
  titleRequired: 'Adaugă un titlu pentru sesiune.',
  notRecurring: 'Sesiunea nu face parte dintr-o serie de sesiuni.',
  cannotCancel: 'Sesiunea nu mai poate fi anulată.',
  cannotReschedule: 'Sesiunea nu mai poate fi reprogramată.',
  capacityBelowConfirmed:
    'Sesiunea are deja {count, plural, one {o rezervare confirmată, așa că are nevoie de cel puțin un loc} few {# rezervări confirmate, așa că are nevoie de cel puțin # locuri} other {# de rezervări confirmate, așa că are nevoie de cel puțin # de locuri}}.',

  audienceBeforeStart:
    'Abia după ce începe sesiunea poți trimite mesaj celor prezenți sau celor care au lipsit.',
  messageRequired: 'Scrie un mesaj înainte să-l trimiți.',
  recipientsRequired: 'Alege cel puțin un participant.',

  invalidDateRange: 'Intervalul de date nu este valid.',
  dateRangeOrder: 'Data de început trebuie să fie înaintea datei de sfârșit.',
  dateRangeTooWide:
    'Intervalul de date este prea lung. Alege cel mult {days, plural, one {o zi} few {# zile} other {# de zile}}.',
};
