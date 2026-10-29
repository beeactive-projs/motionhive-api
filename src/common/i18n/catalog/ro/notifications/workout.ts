import type { Catalog } from '../..';

export const workout: Catalog['notifications']['workout'] = {
  programAssigned: {
    title: 'Ai un program nou',
    body: '{coach} ți-a atribuit programul „{program}”. Începi pe {start}.',
  },
  clientCompletedWorkout: {
    title: '{client} a terminat un antrenament',
    body: '„{workout}” e înregistrat, cu {sets, plural, one {o serie făcută} few {# serii făcute} other {# de serii făcute}}.',
  },
  clientCompletedPlan: {
    title: '{client} a terminat programul „{program}”',
    body: '{count, plural, one {Programul avea un singur antrenament, iar acum e făcut} few {Toate cele # antrenamente sunt făcute} other {Toate cele # de antrenamente sunt făcute}}. E momentul să discutați și să stabiliți ce urmează.',
  },
  workoutTakenDown: {
    title: 'Am scos un antrenament de pe profilul tău',
    body: 'În urma unei raportări, am scos „{workout}” de pe profilul tău pentru {reason, select, SPAM {spam} SCAM {fraudă} HARASSMENT {hărțuire} IMPERSONATION {uzurpare de identitate} SEXUAL {conținut sexual} other {încălcarea regulilor}}. Rămâne în istoricul tău, dar nu mai poate apărea pe profil și nici nu mai poate fi distribuit.',
  },
};
