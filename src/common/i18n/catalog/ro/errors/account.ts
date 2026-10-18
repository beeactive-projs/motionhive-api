import type { Catalog } from '../..';

export const account: Catalog['errors']['account'] = {
  notYou: 'Doar persoana căreia îi aparține contul îl poate șterge.',
  noCodeRequested: 'Cere mai întâi un cod.',
  codeNotSent: 'Nu am putut trimite codul. Încearcă din nou peste un minut.',
  codeInvalid: 'Codul nu este corect. Verifică emailul și încearcă din nou.',
  codeExpired: 'Codul a expirat. Cere unul nou.',
  codeTooManyAttempts: 'Prea multe coduri greșite. Cere unul nou.',
  alreadyScheduled:
    'Acest cont este deja programat pentru ștergere, pe {date}.',
  requestEmailMismatch:
    'Aceasta nu este adresa de email cu care se autentifică acest cont. Dă curs doar unei cereri trimise de pe ea.',
  theirOpenDispute:
    'Această persoană are o contestație de plată la care trebuie să răspundă. Trebuie să îi răspundă din Plăți înainte să îi putem șterge contul.',
  openDispute:
    'Ai o contestație de plată la care trebuie să răspunzi. Răspunde-i din Plăți înainte să îți ștergi contul.',
  restoreExpired:
    'Timpul pentru a-ți păstra contul a expirat. Autentifică-te din nou ca să îl păstrezi.',
  notScheduled: 'Acest cont nu este programat pentru ștergere.',
};
