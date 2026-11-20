import type { Catalog } from '../..';

export const workout: Catalog['notifications']['workout'] = {
  programAssigned: {
    title: 'Ai un program nou',
    body: '{coach, select, null {Antrenorul tău} other {{coach}}} ți-a atribuit programul „{program}”. Începi pe {start}.',
  },
  clientCompletedWorkout: {
    title:
      '{client, select, null {Clientul tău} other {{client}}} a terminat un antrenament',
    body: '„{workout}” e înregistrat, cu {sets, plural, one {o serie făcută} few {# serii făcute} other {# de serii făcute}}.',
  },
  clientCompletedPlan: {
    title:
      '{client, select, null {Clientul tău} other {{client}}} a terminat programul „{program}”',
    body: '{count, plural, one {Programul avea un singur antrenament, iar acum e făcut} few {Toate cele # antrenamente sunt făcute} other {Toate cele # de antrenamente sunt făcute}}. E momentul să discutați și să stabiliți ce urmează.',
  },
  planPaused: {
    title:
      '{coach, select, null {Antrenorul tău} other {{coach}}} a pus „{program}” pe pauză',
    body: 'Zilele planului te așteaptă, iar cele din pauză nu contează ca ratate.{note, select, null {} other { „{note}”}}',
  },
  planResumed: {
    title:
      '{coach, select, null {Antrenorul tău} other {{coach}}} a reluat „{program}”',
    body: '{weeks, plural, =0 {Antrenamentele au rămas în zilele lor.} one {Antrenamentele rămase s-au mutat cu o săptămână mai târziu, în aceleași zile ale săptămânii.} few {Antrenamentele rămase s-au mutat cu # săptămâni mai târziu, în aceleași zile ale săptămânii.} other {Antrenamentele rămase s-au mutat cu # de săptămâni mai târziu, în aceleași zile ale săptămânii.}}{note, select, null {} other { „{note}”}}',
  },
  planFinishedByCoach: {
    title:
      '{coach, select, null {Antrenorul tău} other {{coach}}} a marcat „{program}” ca terminat',
    body: 'Rămâne în istoricul tău ca terminat, la {percent}% făcut.{note, select, null {} other { „{note}”}}',
  },
  planCancelled: {
    title:
      '{coach, select, null {Antrenorul tău} other {{coach}}} a anulat „{program}”',
    body: '{done, plural, =0 {Zilele care urmau au dispărut din calendarul tău.} one {Zilele care urmau au dispărut din calendarul tău. Antrenamentul făcut rămâne în istoricul tău.} few {Zilele care urmau au dispărut din calendarul tău. Cele # antrenamente făcute rămân în istoricul tău.} other {Zilele care urmau au dispărut din calendarul tău. Cele # de antrenamente făcute rămân în istoricul tău.}}{note, select, null {} other { „{note}”}}',
  },
  planAdjusted: {
    title:
      '{coach, select, null {Antrenorul tău} other {{coach}}} ți-a ajustat planul',
    body: '{day}, săptămâna {week}{others, plural, =0 {} one { și încă o zi} few { și încă # zile} other { și încă # de zile}} din „{program}”.',
  },
  workoutAutoSaved: {
    title: 'Ți-am salvat antrenamentul',
    body: '„{workout}” era încă deschis, așa că l-am salvat cu seriile bifate, încheiat la ultima dintre ele. Deschide-l dacă trebuie să corectezi durata.',
  },
  workoutTakenDown: {
    title: 'Am scos un antrenament de pe profilul tău',
    body: 'În urma unei raportări, am scos „{workout}” de pe profilul tău pentru {reason, select, SPAM {spam} SCAM {fraudă} HARASSMENT {hărțuire} IMPERSONATION {uzurpare de identitate} SEXUAL {conținut sexual} other {încălcarea regulilor}}. Rămâne în istoricul tău, dar nu mai poate apărea pe profil și nici nu mai poate fi distribuit.',
  },
};
