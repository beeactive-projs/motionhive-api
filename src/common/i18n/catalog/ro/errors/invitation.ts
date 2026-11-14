import type { Catalog } from '../..';

export const invitation: Catalog['errors']['invitation'] = {
  notFound: 'Nu am găsit invitația.',
  alreadyMember: 'Această persoană face deja parte din grup.',
  alreadyInvited:
    'Există deja o invitație activă pentru această adresă de email.',
  alreadyAccepted: 'Invitația a fost deja acceptată.',
  declined: 'Invitația a fost refuzată.',
  expired: 'Invitația a expirat.',
  alreadyAnswered: 'Invitația a primit deja un răspuns.',
  wrongEmail: 'Această invitație a fost trimisă la altă adresă de email.',
  cannotCancelAccepted: 'Nu poți anula o invitație care a fost deja acceptată.',
  cannotResendAccepted:
    'Nu poți retrimite o invitație care a fost deja acceptată.',
  accountNotFound: 'Nu am găsit contul tău. Autentifică-te din nou.',
  cannotInviteSelf: 'Nu te poți invita pe tine.',
  cannotSuggestSelf: 'Nu te poți recomanda pe tine.',
  notYourClients: 'Aici poți invita doar clienții tăi.',
};
