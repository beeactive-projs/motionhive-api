import type { Catalog } from '../..';

export const post: Catalog['errors']['post'] = {
  notFound: 'Nu am găsit postarea.',
  commentNotFound: 'Nu am găsit comentariul.',
  duplicateGroups: 'Ai ales același grup de mai multe ori.',
  groupsNotFound: 'Nu am găsit unul sau mai multe dintre grupurile alese.',
  cannotPostNotMember:
    'Nu poți publica în „{group}” pentru că nu faci parte din grup.',
  membersCannotPost:
    'Doar administratorul și moderatorii pot publica în „{group}”.',
  onlyAuthorCanEdit: 'Doar autorul poate edita această postare.',
  nothingToUpdate: 'Nu ai modificat nimic.',
  alreadyReviewed:
    '{state, select, APPROVED {Postarea este deja aprobată.} REJECTED {Postarea este deja respinsă.} other {Postarea a fost deja verificată.}}',
  replyTargetNotFound: 'Nu am găsit comentariul la care răspunzi.',
  cannotReplyToReply:
    'Nu poți răspunde la un răspuns. Răspunde la comentariul inițial.',
  notGroupMember: 'Nu faci parte din acest grup.',
  staffOnly: 'Doar administratorul grupului și moderatorii pot face asta.',
  notVisible: 'Nu ai acces la această postare.',
};
