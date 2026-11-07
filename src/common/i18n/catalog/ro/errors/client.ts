import type { Catalog } from '../..';

export const client: Catalog['errors']['client'] = {
  inviteTargetRequired: 'Alege pe cine inviți sau scrie adresa de email.',
  coachesOnly: 'Doar antrenorii pot invita clienți.',
  cannotInviteSelf: 'Nu te poți invita pe tine ca client.',
  invitationAlreadyPending:
    'Există deja o invitație în așteptare pentru această adresă de email.',
  userNotFound: 'Nu am găsit utilizatorul.',
  alreadyYourClient: 'Această persoană face deja parte dintre clienții tăi.',
  alreadyTheirClient: 'Faci deja parte dintre clienții acestui antrenor.',
  requestAlreadyPending:
    'Există deja o cerere sau o invitație în așteptare între tine și această persoană.',
  coachNotFound: 'Nu am găsit antrenorul.',
  cannotRequestSelf: 'Nu poți fi propriul tău client.',
  notACoach: 'Această persoană nu este antrenor.',
  notAcceptingClients: 'Acest antrenor nu acceptă clienți noi momentan.',
  requestNotFound: 'Nu am găsit cererea.',
  requestExpired: 'Această cerere a expirat.',
  requestAlreadyAnswered:
    'Această cerere a fost deja {status, select, ACCEPTED {acceptată} DECLINED {refuzată} CANCELLED {anulată} other {procesată}}.',
  cannotAcceptOthersRequest:
    'Poți accepta doar cererile care ți-au fost trimise.',
  cannotDeclineOthersRequest:
    'Poți refuza doar cererile care ți-au fost trimise.',
  cannotCancelOthersRequest: 'Poți anula doar cererile trimise de tine.',
  invitationNotFound: 'Nu am găsit invitația.',
  invitationUsed: 'Această invitație a fost deja folosită.',
  invitationExpired: 'Această invitație a expirat.',
  invitationAlreadyAnswered:
    'Această invitație a fost deja {status, select, ACCEPTED {acceptată} DECLINED {refuzată} CANCELLED {anulată} other {folosită}}.',
  cannotResendAnswered:
    'Nu poți retrimite o invitație care a fost deja {status, select, ACCEPTED {acceptată} DECLINED {refuzată} CANCELLED {anulată} other {folosită}}.',
  clientNotFound: 'Nu am găsit clientul.',
  notYourCoach: 'Nu faci parte dintre clienții acestui antrenor.',
  importDailyLimit:
    '{remaining, plural, =0 {Azi nu mai poți trimite invitații.} one {Azi mai poți trimite o singură invitație.} few {Azi mai poți trimite # invitații.} other {Azi mai poți trimite # de invitații.}} Importă mai puține persoane sau încearcă din nou mâine.',
  alreadyLeftCoach: 'Te-ai oprit deja din antrenamentele cu acest antrenor.',
};
