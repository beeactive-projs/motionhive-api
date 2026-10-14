import type { Catalog } from '../..';

export const workout: Catalog['errors']['workout'] = {
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
  programNeedsOneWeek: 'Un program are nevoie de cel puțin o săptămână.',
  cannotDeleteLiveWeek:
    '{clients, plural, one {Un client urmează} few {# clienți urmează} other {# de clienți urmează}} acest program, așa că nu poți șterge săptămâna {week}. S-ar pierde {days, plural, one {o zi de antrenament} few {# zile de antrenament} other {# de zile de antrenament}} din {clients, plural, one {planul pe care îl urmează acum. Încheie sau anulează mai întâi programul atribuit.} other {planurile pe care le urmează acum. Încheie sau anulează mai întâi programele atribuite.}}',
  cannotShortenLiveProgram:
    '{clients, plural, one {Un client urmează} few {# clienți urmează} other {# de clienți urmează}} acest program, așa că nu îl poți scurta la {weeks, plural, one {o săptămână} few {# săptămâni} other {# de săptămâni}}. S-ar pierde {days, plural, one {o zi de antrenament} few {# zile de antrenament} other {# de zile de antrenament}} din {clients, plural, one {planul pe care îl urmează acum. Încheie sau anulează mai întâi programul atribuit.} other {planurile pe care le urmează acum. Încheie sau anulează mai întâi programele atribuite.}}',
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
  pickTrainingDays:
    'Programul are {count, plural, one {o zi de antrenament} few {# zile de antrenament} other {# de zile de antrenament}} pe săptămână. Alege exact {count, plural, one {o zi} few {# zile} other {# de zile}}.',
  assignmentClosed:
    'Programul atribuit e {status, select, COMPLETED {încheiat} CANCELLED {anulat} other {închis}}, așa că starea lui nu se mai poate schimba.',

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
  cannotDiscardFinished:
    'Poți anula doar un antrenament în desfășurare. Antrenamentele terminate rămân în istoricul tău.',
  alreadyInProgress:
    '{name} este încă în desfășurare. Termină-l sau renunță la el înainte să începi alt antrenament.',
};
