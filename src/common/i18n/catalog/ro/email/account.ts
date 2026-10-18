import type { Catalog } from '../..';

export const account: Catalog['email']['account'] = {
  deletionCode: {
    subject: 'Codul pentru ștergerea contului tău MotionHive',
    preheader: 'Introdu acest cod în aplicație ca să confirmi că ești tu',
    eyebrow: 'SECURITATE',
    heading: 'Confirmă că ești tu',
    body: '{name, select, null {Salut!} other {Salut, {name}!}} Ai cerut ștergerea contului tău MotionHive. Introdu acest cod în aplicație ca să confirmi că ești tu.',
    expiry: 'Codul este valabil 15 minute.',
    warning:
      'Dacă nu tu ai cerut asta, e posibil ca altcineva să îți știe parola. Schimb-o acum, iar contul tău rămâne neatins.',
    cta: 'Schimbă parola',
    help: 'Ai nevoie de ajutor? Răspunde la acest email și te ajutăm cu drag.',
  },
  deletionScheduled: {
    subject: 'Contul tău MotionHive va fi șters pe {date}',
    preheader:
      'Te-ai răzgândit? Autentifică-te înainte de {date} ca să îl păstrezi.',
    eyebrow: 'CONTUL TĂU',
    heading: 'Contul tău se închide',
    body: '{name, select, null {Salut!} other {Salut, {name}!}} Contul tău MotionHive este dezactivat, iar pe **{date}** îl vom șterge și îți vom elimina datele personale.',
    woundDown:
      'Nimeni nu îți mai poate vedea profilul. Abonamentele tale nu se vor mai reînnoi, iar sesiunile și rezervările viitoare sunt anulate. Toți cei afectați au fost anunțați.',
    keep: 'Te-ai răzgândit? Autentifică-te înainte de **{date}** și alege să îți păstrezi contul. Ce a fost anulat rămâne anulat.',
    cta: 'Autentifică-te ca să păstrezi contul',
    retained:
      'Păstrăm doar ce cere legea: facturile și evidența plăților timp de 5 ani și o înregistrare a faptului că ți-ai șters contul, timp de 3 ani.',
    help: 'Ai nevoie de ajutor? Răspunde la acest email și te ajutăm cu drag.',
  },
  deletionCancelled: {
    subject: 'Contul tău MotionHive nu va mai fi șters',
    preheader: 'Te-ai autentificat și ți-ai păstrat contul',
    eyebrow: 'SECURITATE',
    heading: 'Contul tău rămâne',
    body: '{name, select, null {Salut!} other {Salut, {name}!}} Te-ai autentificat și ți-ai păstrat contul MotionHive, așa că nu va mai fi șters. Abonamentele, sesiunile și grupurile încheiate când ai cerut ștergerea rămân încheiate.',
    warning: 'Dacă nu ai fost tu, schimbă-ți parola acum.',
    cta: 'Schimbă parola',
    help: 'Ai nevoie de ajutor? Răspunde la acest email și te ajutăm cu drag.',
  },
  deletionCompleted: {
    subject: 'Contul tău MotionHive a fost șters',
    preheader: 'Contul și datele tale personale au fost eliminate',
    eyebrow: 'CONTUL TĂU',
    heading: 'Contul tău a fost șters',
    body: '{name, select, null {Salut!} other {Salut, {name}!}} Așa cum ai cerut, ți-am șters contul MotionHive și ți-am eliminat datele personale.',
    retained:
      'Păstrăm doar ce cere legea: facturile și evidența plăților timp de 5 ani și o înregistrare a faptului că ți-ai șters contul, timp de 3 ani.',
    backups:
      'Copiile noastre de siguranță se înlocuiesc în cel mult 90 de zile. Până atunci, datele tale pot rămâne într-una dintre ele, nefolosite.',
    help: 'Ai întrebări? Răspunde la acest email și te ajutăm cu drag.',
  },
};
