import type { Catalog } from '../..';

export const workout: Catalog['errors']['workout'] = {
  planTooLarge:
    'Planul ar avea peste {max, number} de serii. Programează mai puține săptămâni sau zile, ori o rutină mai scurtă.',
  // ─── Not found ───────────────────────────────────────────────────
  programNotFound: 'Nu am găsit programul.',
  routineNotFound: 'Nu am găsit rutina.',
  workoutNotFound: 'Nu am găsit antrenamentul.',
  weekNotFound: 'Nu am găsit săptămâna.',
  setNotFound: 'Nu am găsit seria.',
  assignmentNotFound: 'Nu am găsit programul atribuit.',
  clientNotFound: 'Nu am găsit clientul.',
  logNotFound: 'Nu am găsit antrenamentul înregistrat.',

  // ─── Program builder ─────────────────────────────────────────────
  exercisesOnlyOnRoutine:
    'Poți adăuga exerciții direct doar într-o rutină. Într-un program de mai multe săptămâni, adaugă-le în antrenamentul dorit.',
  routineHasNoWorkout:
    'Rutina nu are niciun antrenament în care să adaugi exerciții.',
  reorderDuplicate:
    'Același element apare de două ori în noua ordine. Reîncarcă pagina și încearcă din nou.',
  reorderPositionClash:
    'Două elemente ar ajunge pe poziția {position}. Reîncarcă pagina și încearcă din nou.',
  slotTaken: 'Există deja un antrenament în săptămâna {week}, ziua {day}.',
  slotClash: 'Două antrenamente ar ajunge în săptămâna {week}, ziua {day}.',
  copyWeekSameWeek: 'Alege o altă săptămână decât cea pe care o copiezi.',
  weekEmpty: 'Săptămâna aleasă nu are nimic de copiat.',
  copyDayOneWeek:
    'Ca să copiezi antrenamentul pe altă zi, alege o singură săptămână de destinație.',
  copyDayNoTarget: 'Alege cel puțin încă o săptămână în care să copiezi.',
  dayEmpty: 'Ziua aleasă nu are nimic de copiat.',
  routineNoWeeksToRepeat: 'O rutină nu are săptămâni de repetat.',
  programNeedsLength:
    'Setează mai întâi durata programului, ca să existe săptămâni de completat.',
  nothingToRepeat: 'Încă nu ai nimic de repetat.',
  routineNoWeeksToDelete: 'O rutină nu are săptămâni de șters.',
  routineNoWeeksToAdd: 'O rutină nu are săptămâni la care să adaugi.',
  routineNoWeeksToClear: 'O rutină nu are săptămâni de golit.',
  programNeedsOneWeek: 'Un program are nevoie de cel puțin o săptămână.',
  programTooLong:
    'Un program durează cel mult {weeks, plural, one {o săptămână} few {# săptămâni} other {# de săptămâni}}.',
  setListDuplicate:
    'Aceeași serie apare de două ori în listă. Reîncarcă pagina și încearcă din nou.',
  cannotPublishWithoutName:
    '{kind, select, routine {Dă-i rutinei un nume înainte să o publici.} other {Dă-i programului un nume înainte să îl publici.}}',
  cannotPublishWithoutExercises:
    '{kind, select, routine {Adaugă cel puțin un exercițiu în rutină înainte să o publici.} other {Adaugă exerciții în cel puțin o zi înainte să publici programul.}}',
  repRangeInvalid:
    'Numărul minim de repetări nu poate fi mai mare decât cel maxim.',
  weightModeConflict:
    'Alege fie o greutate în kg, fie un procent din 1RM (greutatea maximă la o repetare), nu amândouă.',

  // ─── Assignments ─────────────────────────────────────────────────
  cannotAssignDeleted: 'Nu poți atribui un program șters.',
  assignActiveClientsOnly: 'Poți atribui programe doar clienților tăi activi.',
  routineNothingToSchedule:
    'Rutina nu are încă exerciții, așa că nu ai ce planifica.',
  blockNeedsWeeks: 'Alege pentru câte săptămâni se repetă rutina.',
  cannotSkipCompleted:
    'Antrenamentul e deja terminat, așa că nu mai poți sări peste el.',
  dayAlreadyFinished:
    'Ziua aceasta din plan e deja făcută, așa că nu o mai poți începe.',
  planNotActive:
    'Planul e {status, select, PAUSED {pus pe pauză} COMPLETED {încheiat} CANCELLED {anulat} other {inactiv}}, așa că nu îi poți începe antrenamentele.',
  pickTrainingDays:
    'Programul are {count, plural, one {o zi de antrenament} few {# zile de antrenament} other {# de zile de antrenament}} pe săptămână. Alege exact {count, plural, one {o zi} few {# zile} other {# de zile}}.',
  assignmentClosed:
    'Programul atribuit e {status, select, COMPLETED {încheiat} CANCELLED {anulat} other {închis}}, așa că starea lui nu se mai poate schimba.',

  // ─── A client's copy of a plan ───────────────────────────────────
  copyPlanClosed:
    'Planul nu mai e în desfășurare, așa că zilele lui nu se mai pot schimba.',
  copyDayDone: 'Ziua aceasta e făcută, așa că nu se mai poate schimba.',
  copyDaySkipped: 'Ziua aceasta a fost sărită, așa că nu se mai poate schimba.',
  copyDayStarted:
    'Ziua aceasta a fost începută, așa că nu se mai poate schimba.',
  copyDayPast: 'Data zilei a trecut, așa că nu se mai poate schimba.',
  copyDatePast: 'O zi nu se poate muta pe o dată care a trecut.',
  copyDateOutsidePlan: 'Alege o dată din plan, între prima și ultima lui zi.',
  copyDateTaken: 'Altă zi a planului e deja la data aceea. Alege una liberă.',
  copyCannotRevert:
    'Exercițiul acesta nu are valori din program la care să revină: a fost adăugat pentru acest client sau rândul lui din program a fost șters.',

  // ─── Workout logging ─────────────────────────────────────────────
  startOneSource:
    'Începe fie un antrenament din plan, fie o rutină, nu amândouă.',
  freestyleNameRequired:
    'Dă un nume antrenamentului liber ca să-l poți începe.',
  programNothingToStart:
    'Programul nu are încă antrenamente, așa că nu ai ce începe.',
  nothingToSaveAsRoutine:
    'Antrenamentul nu are exerciții pe care să le salvezi ca rutină.',
  cannotLogSetsNotInProgress:
    'Nu poți înregistra serii într-un antrenament care nu mai e în desfășurare.',
  cannotAddExercisesNotInProgress:
    'Nu poți adăuga exerciții într-un antrenament care nu mai e în desfășurare.',
  cannotEditNotInProgress:
    'Nu poți modifica un antrenament care nu mai e în desfășurare.',
  cannotAddSetsNotInProgress:
    'Nu poți adăuga serii într-un antrenament care nu mai e în desfășurare.',
  sameExerciseSwap: 'Acesta e deja exercițiul pe care îl înregistrezi.',
  cannotCompleteNotInProgress:
    'Poți termina doar un antrenament în desfășurare.',
  photoNotFinished: 'Poți adăuga o fotografie după ce termini antrenamentul.',
  photoJpegOnly: 'Trimite fotografia în format JPEG.',
  photoNotFound: 'Antrenamentul nu are nicio fotografie.',
  durationNotFinished:
    'Poți corecta durata doar după ce termini antrenamentul.',
  durationOutOfRange: 'Un antrenament durează între 1 minut și 6 ore.',
  pauseGapTooLong:
    'Antrenamentul nu rulează de atât timp, așa că nu poate fi pus pe pauză atât de mult.',

  // ─── Reports and takedowns ───────────────────────────────────────
  takenDownNoShare:
    'Antrenamentul a fost scos în urma unei raportări, așa că nu poate fi distribuit.',
  takenDownStaysPrivate:
    'Antrenamentul a fost scos în urma unei raportări, așa că trebuie să rămână privat.',
  cannotReportOwn: 'Nu îți poți raporta propriul antrenament.',
  reportAlreadyOpen: 'Ai raportat deja acest antrenament. Ne uităm la el.',
  reportNotFound: 'Raportul nu a fost găsit.',
  reportTransition: 'Raportul nu mai poate trece în această stare.',
  takeDownNeedsResolve:
    'Scoaterea unui antrenament rezolvă raportul, așa că alege starea „rezolvat”.',
  alreadyInProgress:
    '{name} este încă în desfășurare. Termină-l sau renunță la el înainte să începi alt antrenament.',
};
