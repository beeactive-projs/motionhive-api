import type { Catalog } from '../..';

export const messaging: Catalog['errors']['messaging'] = {
  conversationNotFound: 'Nu am găsit conversația.',
  messageNotFound: 'Nu am găsit mesajul.',
  userNotFound: 'Nu am găsit utilizatorul.',
  cannotMessageSelf: 'Nu îți poți trimite un mesaj ție.',
  emptyMessage: 'Mesajul e gol. Scrie ceva înainte să-l trimiți.',
  suspended:
    'Trimiterea de mesaje ți-a fost restricționată. Contactează echipa de suport.',
  newAccountLimited:
    'Un cont nou poate scrie doar persoanelor cu care se antrenează sau celor care i-au scris primii.',
  connectionsOnly:
    'Această persoană primește mesaje doar de la cei cu care se antrenează.',
  requestWaiting:
    'Solicitarea ta de mesaj așteaptă. Poți scrie din nou după ce {name, select, null {e acceptată} other {{name} o acceptă}}.',
  requestLimit: 'Ai început multe conversații noi azi. Încearcă din nou mâine.',
  notARequest: 'Această conversație nu este o solicitare de mesaj.',
  acceptRequestFirst: 'Acceptă mai întâi solicitarea de mesaj.',
  notShareable:
    'Nu se poate trimite. Se pot trimite doar lucruri pe care le vede oricine, iar o sesiune doar până se încheie.',
  tooManyMessages:
    'Poți trimite cel mult {max, plural, one {# mesaj} few {# mesaje} other {# de mesaje}} pe minut. Așteaptă puțin și încearcă din nou.',
  tooManyMessagesInConversation:
    'Trimiți prea multe mesaje în această conversație. Așteaptă puțin și încearcă din nou.',
  youBlockedThem:
    'Ai blocat această persoană. Deblocheaz-o ca să îi poți scrie.',
  cannotLoadOlderMessages:
    'Nu am putut încărca mesajele mai vechi. Reîncarcă conversația și încearcă din nou.',
  invalidDate: 'Alege o dată și o oră valide.',
  cannotLeaveDirect:
    'Nu poți ieși dintr-o conversație privată. Dacă nu mai vrei mesaje de la această persoană, blocheaz-o.',
  cannotDeleteOthersMessage: 'Poți șterge doar mesajele tale.',
  cannotBlockSelf: 'Nu te poți bloca pe tine.',
  alreadyBlocked: 'Ai blocat deja acest utilizator.',
  notBlocked: 'Nu ai blocat acest utilizator.',
  reportTargetRequired:
    'Alege mesajul sau conversația pe care vrei să o raportezi.',
  cannotReportSelf: 'Nu îți poți raporta propriile mesaje.',
  reportAlreadyOpen:
    'Ai trimis deja o sesizare despre acest utilizator. Echipa noastră o va analiza.',
  cannotReportSystemMessage: 'Nu poți raporta un mesaj de sistem.',
  reportSpecificMessage:
    'În conversațiile de grup, alege mesajul pe care vrei să-l raportezi.',
  reportTargetUnclear:
    'Nu am putut identifica persoana pe care o raportezi în această conversație. Alege mesajul pe care vrei să-l raportezi.',
};
