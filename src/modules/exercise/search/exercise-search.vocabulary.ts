/**
 * What people type when they look for an exercise, mapped to what the
 * library calls it. Internal search terms, not copy: every key and value is
 * already folded the way `searchWords` folds a query (lowercase, no
 * diacritics, single spaces, letters and digits only).
 *
 * Plurals, word starts and joined words ("pushup") need no entry here: the
 * matcher already handles them. An entry is for a word the library never
 * uses: shorthand ("rdl"), another name for the same movement ("pec deck"),
 * a common misspelling, or a body part that spans several muscles ("legs").
 */

/**
 * Words that never narrow a search on their own ("squat with bands" is
 * "squat bands"). Dropped from the query unless nothing else is left.
 */
export const SEARCH_STOPWORDS: ReadonlySet<string> = new Set([
  // English
  'a',
  'an',
  'and',
  'at',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  // Romanian
  'cu',
  'de',
  'din',
  'la',
  'o',
  'pe',
  'pentru',
  'sau',
  'si',
  'un',
]);

/**
 * Other ways to say a word or a phrase. Keys may be one word or several;
 * values are what the library says instead. A phrase key is matched as a
 * whole ("skull crusher"), before the query is split into words.
 */
export const SEARCH_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  // Equipment shorthand and misspellings
  bb: ['barbell'],
  barbel: ['barbell'],
  db: ['dumbbell'],
  dbs: ['dumbbell'],
  dumbel: ['dumbbell'],
  dumbell: ['dumbbell'],
  dumbells: ['dumbbell'],
  haltera: ['bara'],
  haltere: ['bara'],
  kb: ['kettlebell'],
  kbs: ['kettlebell'],
  trx: ['suspended'],

  // Lift shorthand
  bp: ['bench press'],
  ghr: ['glute ham raise'],
  ohp: ['overhead press', 'military press', 'shoulder press'],
  rdl: ['romanian deadlift'],
  rdls: ['romanian deadlift'],
  sldl: ['stiff legged deadlift'],

  // The same movement under another name
  'back extension': ['hyperextension'],
  'bicycle crunch': ['air bike'],
  'bulgarian split squat': ['split squat'],
  // "Farmer's Walk" folds to "farmer s walk".
  'farmer carry': ['farmer s walk'],
  'farmers carry': ['farmer s walk'],
  flies: ['flye', 'crossover', 'butterfly'],
  fly: ['flye', 'crossover', 'butterfly'],
  flys: ['flye', 'crossover', 'butterfly'],
  'jump rope': ['rope jumping'],
  'jumping jack': ['star jump'],
  'jumping jacks': ['star jump'],
  'lat raise': ['lateral raise'],
  'military press': ['overhead press', 'shoulder press'],
  'overhead press': ['military press', 'shoulder press'],
  'pec deck': ['butterfly'],
  'press up': ['push up'],
  'press ups': ['push up'],
  'shoulder press': ['military press', 'overhead press'],
  'side plank': ['side bridge'],
  'skull crusher': ['lying triceps press', 'skullcrusher'],
  'skull crushers': ['lying triceps press', 'skullcrusher'],
  skullcrusher: ['skull crusher', 'lying triceps press'],
  skullcrushers: ['skull crusher', 'lying triceps press'],

  // Cardio
  bike: ['bicycling'],
  cycling: ['bicycling'],
  jog: ['jogging'],
  rower: ['rowing'],
  run: ['running'],
  skipping: ['rope jumping'],
};

/**
 * Body parts people search by that are not one of our muscle names, mapped
 * to muscle slugs (`muscle.slug`). A muscle's own names (English, Latin,
 * Romanian) need no entry: "chest", "piept", "quadriceps" and "glute"
 * resolve from the taxonomy itself.
 */
export const MUSCLE_GROUP_TERMS: Readonly<Record<string, readonly string[]>> = {
  // English
  ab: ['abdominals'],
  abs: ['abdominals'],
  arm: ['biceps', 'triceps', 'forearms'],
  arms: ['biceps', 'triceps', 'forearms'],
  back: ['lats', 'middle_back', 'lower_back', 'traps'],
  bum: ['glutes'],
  butt: ['glutes'],
  calf: ['calves'],
  core: ['abdominals', 'lower_back'],
  delt: ['shoulders'],
  delts: ['shoulders'],
  deltoid: ['shoulders'],
  deltoids: ['shoulders'],
  ham: ['hamstrings'],
  hams: ['hamstrings'],
  hip: ['glutes', 'adductors', 'abductors'],
  hips: ['glutes', 'adductors', 'abductors'],
  leg: [
    'quadriceps',
    'hamstrings',
    'glutes',
    'calves',
    'adductors',
    'abductors',
  ],
  legs: [
    'quadriceps',
    'hamstrings',
    'glutes',
    'calves',
    'adductors',
    'abductors',
  ],
  obliques: ['abdominals'],
  pec: ['chest'],
  pecs: ['chest'],
  quad: ['quadriceps'],
  quads: ['quadriceps'],
  thigh: ['quadriceps', 'hamstrings', 'adductors', 'abductors'],
  thighs: ['quadriceps', 'hamstrings', 'adductors', 'abductors'],
  'upper back': ['middle_back', 'traps', 'lats'],
  // Romanian
  abdomene: ['abdominals'],
  brat: ['biceps', 'triceps', 'forearms'],
  brate: ['biceps', 'triceps', 'forearms'],
  coapse: ['quadriceps', 'hamstrings', 'adductors', 'abductors'],
  cvadriceps: ['quadriceps'],
  deltoizi: ['shoulders'],
  fese: ['glutes'],
  ischiogambieri: ['hamstrings'],
  oblici: ['abdominals'],
  pectorali: ['chest'],
  picior: [
    'quadriceps',
    'hamstrings',
    'glutes',
    'calves',
    'adductors',
    'abductors',
  ],
  picioare: [
    'quadriceps',
    'hamstrings',
    'glutes',
    'calves',
    'adductors',
    'abductors',
  ],
  spate: ['lats', 'middle_back', 'lower_back', 'traps'],
};
