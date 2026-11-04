import { popularityScores } from '../exercise-popularity.service';
import {
  buildSearchPlan,
  ExerciseSearchPlan,
  personalScore,
  RankCandidate,
  rankExercises,
  SearchTaxonomy,
  searchWhereSql,
  searchWords,
  trigramSimilarity,
} from './exercise-search';

// ── Fixture: the taxonomy and a slice of the real library ─────────────

const MUSCLES: Array<[slug: string, names: string[]]> = [
  ['chest', ['Chest', 'Pectoralis major', 'Piept']],
  ['shoulders', ['Shoulders', 'Deltoideus', 'Umeri']],
  ['triceps', ['Triceps', 'Triceps brachii', 'Triceps']],
  ['biceps', ['Biceps', 'Biceps brachii', 'Biceps']],
  ['forearms', ['Forearms', 'Antebrațe']],
  ['lats', ['Lats', 'Latissimus dorsi', 'Dorsali']],
  ['middle_back', ['Middle back', 'Rhomboideus', 'Mijlocul spatelui']],
  ['lower_back', ['Lower back', 'Erector spinae', 'Lombari']],
  ['traps', ['Traps', 'Trapezius', 'Trapez']],
  ['neck', ['Neck', 'Gât']],
  ['abdominals', ['Abdominals', 'Rectus abdominis', 'Abdomen']],
  ['quadriceps', ['Quadriceps', 'Quadriceps femoris', 'Cvadricepși']],
  ['hamstrings', ['Hamstrings', 'Femurali']],
  ['glutes', ['Glutes', 'Gluteus maximus', 'Fesieri']],
  ['calves', ['Calves', 'Gastrocnemius', 'Gambe']],
  ['adductors', ['Adductors', 'Adductori']],
  ['abductors', ['Abductors', 'Abductori']],
];

const EQUIPMENT: Array<[slug: string, names: string[]]> = [
  ['barbell', ['Barbell', 'Bară']],
  ['dumbbell', ['Dumbbell', 'Gantere']],
  ['kettlebell', ['Kettlebell', 'Kettlebell']],
  ['cable', ['Cable', 'Scripete']],
  ['machine', ['Machine', 'Aparat']],
  ['bodyweight', ['Bodyweight', 'Greutatea corpului']],
  ['bands', ['Bands', 'Benzi elastice']],
  ['ez_bar', ['EZ bar', 'Bară EZ']],
  ['bench', ['Bench', 'Bancă']],
  ['pull_up_bar', ['Pull-up bar', 'Bară de tracțiuni']],
  ['other', ['Other', 'Altele']],
];

const TAXONOMY: SearchTaxonomy = {
  muscles: MUSCLES.map(([slug, names]) => ({ id: `m-${slug}`, slug, names })),
  equipment: EQUIPMENT.map(([slug, names]) => ({
    id: `e-${slug}`,
    slug,
    names,
  })),
};

interface Row {
  slug: string;
  name: string;
  ro?: string;
  primary: string[];
  secondary?: string[];
  equipment: string[];
}

const LIBRARY: Row[] = [
  {
    slug: 'seed-deadlift',
    name: 'Deadlift',
    ro: 'Îndreptări',
    primary: ['hamstrings', 'glutes'],
    equipment: ['barbell'],
  },
  {
    slug: 'barbell-deadlift',
    name: 'Barbell Deadlift',
    ro: 'Îndreptări cu bara',
    primary: ['lower_back'],
    secondary: ['hamstrings', 'glutes'],
    equipment: ['barbell'],
  },
  {
    slug: 'axle-deadlift',
    name: 'Axle Deadlift',
    primary: ['lower_back'],
    equipment: ['barbell'],
  },
  {
    slug: 'car-deadlift',
    name: 'Car Deadlift',
    primary: ['quadriceps'],
    equipment: ['other'],
  },
  {
    slug: 'clean-deadlift',
    name: 'Clean Deadlift',
    primary: ['hamstrings'],
    equipment: ['barbell'],
  },
  {
    slug: 'deadlift-with-bands',
    name: 'Deadlift with Bands',
    primary: ['lower_back'],
    equipment: ['barbell', 'bands'],
  },
  {
    slug: 'kettlebell-one-legged-deadlift',
    name: 'Kettlebell One-Legged Deadlift',
    primary: ['hamstrings'],
    equipment: ['kettlebell'],
  },
  {
    slug: 'romanian-deadlift',
    name: 'Romanian Deadlift',
    ro: 'Îndreptări românești',
    primary: ['hamstrings'],
    equipment: ['barbell'],
  },
  {
    slug: 'seed-back-squat',
    name: 'Back Squat',
    primary: ['quadriceps'],
    equipment: ['barbell'],
  },
  {
    slug: 'barbell-squat',
    name: 'Barbell Squat',
    ro: 'Genuflexiuni cu bara',
    primary: ['quadriceps'],
    secondary: ['glutes'],
    equipment: ['barbell'],
  },
  {
    slug: 'goblet-squat',
    name: 'Goblet Squat',
    ro: 'Genuflexiuni goblet',
    primary: ['quadriceps'],
    equipment: ['kettlebell'],
  },
  {
    slug: 'box-squat',
    name: 'Box Squat',
    ro: 'Genuflexiuni pe cutie',
    primary: ['quadriceps'],
    equipment: ['barbell'],
  },
  {
    slug: 'chair-squat',
    name: 'Chair Squat',
    primary: ['quadriceps'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'jefferson-squats',
    name: 'Jefferson Squats',
    primary: ['quadriceps'],
    equipment: ['barbell'],
  },
  {
    slug: 'leg-press',
    name: 'Leg Press',
    ro: 'Presă pentru picioare',
    primary: ['quadriceps'],
    equipment: ['machine'],
  },
  {
    slug: 'standing-calf-raises',
    name: 'Standing Calf Raises',
    primary: ['calves'],
    equipment: ['machine'],
  },
  {
    slug: 'hamstring-stretch',
    name: 'Hamstring Stretch',
    primary: ['hamstrings'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'pushups',
    name: 'Pushups',
    ro: 'Flotări',
    primary: ['chest'],
    secondary: ['triceps'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'push-up-wide',
    name: 'Push-Up Wide',
    ro: 'Flotări cu mâinile depărtate',
    primary: ['chest'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'incline-push-up',
    name: 'Incline Push-Up',
    ro: 'Flotări înclinate',
    primary: ['chest'],
    equipment: ['bodyweight'],
  },
  {
    slug: 'barbell-bench-press-medium-grip',
    name: 'Barbell Bench Press, Medium Grip',
    ro: 'Împins la piept cu bara, priză medie',
    primary: ['chest'],
    secondary: ['triceps', 'shoulders'],
    equipment: ['barbell', 'bench'],
  },
  {
    slug: 'dumbbell-bench-press',
    name: 'Dumbbell Bench Press',
    ro: 'Împins la piept cu gantere',
    primary: ['chest'],
    equipment: ['dumbbell', 'bench'],
  },
  {
    slug: 'barbell-incline-bench-press-medium-grip',
    name: 'Barbell Incline Bench Press, Medium Grip',
    primary: ['chest'],
    equipment: ['barbell', 'bench'],
  },
  {
    slug: 'incline-dumbbell-press',
    name: 'Incline Dumbbell Press',
    primary: ['chest'],
    equipment: ['dumbbell', 'bench'],
  },
  {
    slug: 'dumbbell-flyes',
    name: 'Dumbbell Flyes',
    ro: 'Fluturări cu gantere',
    primary: ['chest'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'cable-crossover',
    name: 'Cable Crossover',
    primary: ['chest'],
    equipment: ['cable'],
  },
  {
    slug: 'butterfly',
    name: 'Butterfly',
    primary: ['chest'],
    equipment: ['machine'],
  },
  {
    slug: 'reverse-flyes',
    name: 'Reverse Flyes',
    primary: ['shoulders'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'behind-head-chest-stretch',
    name: 'Behind Head Chest Stretch',
    primary: ['chest'],
    equipment: ['other'],
  },
  {
    slug: 'standing-military-press',
    name: 'Standing Military Press',
    primary: ['shoulders'],
    equipment: ['barbell'],
  },
  {
    slug: 'barbell-shoulder-press',
    name: 'Barbell Shoulder Press',
    primary: ['shoulders'],
    equipment: ['barbell'],
  },
  {
    slug: 'dumbbell-shoulder-press',
    name: 'Dumbbell Shoulder Press',
    primary: ['shoulders'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'pullups',
    name: 'Pullups',
    ro: 'Tracțiuni',
    primary: ['lats'],
    equipment: ['pull_up_bar'],
  },
  {
    slug: 'band-good-morning-pull-through',
    name: 'Band Good Morning (Pull Through)',
    primary: ['hamstrings'],
    equipment: ['bands'],
  },
  {
    slug: 'pull-through',
    name: 'Pull Through',
    primary: ['glutes'],
    equipment: ['cable'],
  },
  {
    slug: 'wide-grip-lat-pulldown',
    name: 'Wide-Grip Lat Pulldown',
    primary: ['lats'],
    equipment: ['cable'],
  },
  {
    slug: 'one-arm-dumbbell-row',
    name: 'One-Arm Dumbbell Row',
    ro: 'Ramat cu o mână cu gantera',
    primary: ['middle_back'],
    secondary: ['lats'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'bent-over-two-dumbbell-row',
    name: 'Bent Over Two-Dumbbell Row',
    primary: ['middle_back'],
    equipment: ['dumbbell'],
  },
  {
    slug: 'bent-over-barbell-row',
    name: 'Bent Over Barbell Row',
    primary: ['middle_back'],
    equipment: ['barbell'],
  },
  {
    slug: 'lying-triceps-press',
    name: 'Lying Triceps Press',
    primary: ['triceps'],
    equipment: ['ez_bar'],
  },
  {
    slug: 'ez-bar-skullcrusher',
    name: 'EZ-Bar Skullcrusher',
    primary: ['triceps'],
    equipment: ['ez_bar'],
  },
  {
    slug: 'dumbbell-bicep-curl',
    name: 'Dumbbell Bicep Curl',
    primary: ['biceps'],
    equipment: ['dumbbell'],
  },
];

/** Popularity as the nightly job writes it with no logs yet: the editorial rank only. */
const POPULARITY = popularityScores(
  LIBRARY.map((row) => ({
    id: row.slug,
    slug: row.slug,
    source: 'SYSTEM',
    users: 0,
    authors: 0,
  })),
);

function candidate(row: Row, locale: 'en' | 'ro' = 'en'): RankCandidate {
  const ids = (slugs: string[] | undefined, prefix: string) =>
    (slugs ?? []).map((slug) => `${prefix}-${slug}`);
  return {
    id: row.slug,
    name: row.name,
    localeName: locale === 'ro' && row.ro ? row.ro : row.name,
    // `search_name` (migration 080): every name, folded.
    searchName: searchWords(`${row.name} ${row.ro ?? ''}`),
    popularity: POPULARITY.get(row.slug) ?? 0,
    primaryMuscleIds: ids(row.primary, 'm'),
    secondaryMuscleIds: ids(row.secondary, 'm'),
    equipmentIds: ids(row.equipment, 'e'),
  };
}

/**
 * The SQL condition (`searchWhereSql`) evaluated in memory, so a test ranks
 * exactly the rows the database would return. Postgres `<%` is word
 * similarity; trigram similarity per word stands in for it.
 */
function accepts(plan: ExerciseSearchPlan, c: RankCandidate): boolean {
  const name = c.searchName;
  const together = (compact: string) =>
    new RegExp(`(^| )${compact.split('').join(' ?')}`).test(name);
  const tokenMatches = (
    token: ExerciseSearchPlan['variants'][number][number],
  ) =>
    token.forms.some(
      (form) =>
        name.startsWith(form.text) ||
        name.includes(` ${form.text}`) ||
        (form.compact.length >= 4 && together(form.compact)),
    ) ||
    (token.fuzzy &&
      name
        .split(' ')
        .some((word) => trigramSimilarity(token.word, word) >= 0.6)) ||
    [...c.primaryMuscleIds, ...c.secondaryMuscleIds].some((id) =>
      token.muscleIds.includes(id),
    ) ||
    c.equipmentIds.some((id) => token.equipmentIds.includes(id));
  return (
    plan.variants.some((tokens) => tokens.every(tokenMatches)) ||
    (plan.compact.length >= 4 && together(plan.compact))
  );
}

function search(
  query: string,
  options: { locale?: 'en' | 'ro'; personal?: Record<string, number> } = {},
): string[] {
  const plan = buildSearchPlan(query, TAXONOMY);
  const candidates = LIBRARY.map((row) =>
    candidate(row, options.locale),
  ).filter((c) => accepts(plan, c));
  return rankExercises(
    plan,
    candidates,
    new Map(Object.entries(options.personal ?? {})),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('searchWords', () => {
  it('folds case, accents and punctuation into single spaces', () => {
    expect(searchWords('  Push-Up, Wide ')).toBe('push up wide');
    expect(searchWords('Împins la piept')).toBe('impins la piept');
    expect(searchWords("Farmer's Walk")).toBe('farmer s walk');
  });

  it('leaves no LIKE wildcards behind, fullwidth ones included', () => {
    expect(searchWords('100% squat_jump ％')).toBe('100 squat jump');
  });
});

describe('buildSearchPlan', () => {
  const forms = (query: string, token = 0) =>
    buildSearchPlan(query, TAXONOMY).variants[0][token].forms.map(
      (f) => f.text,
    );

  it('drops stopwords, unless nothing else was typed', () => {
    expect(buildSearchPlan('squat with bands', TAXONOMY).text).toBe(
      'squat bands',
    );
    expect(buildSearchPlan('with', TAXONOMY).text).toBe('with');
  });

  it('adds stems and synonyms as forms of a word', () => {
    expect(forms('squats')).toEqual(['squats', 'squat']);
    expect(forms('flotare')).toEqual(['flotare', 'flotar']);
    expect(forms('db')).toEqual(['db', 'dumbbell']);
    expect(forms('rdl')).toEqual(['rdl', 'romanian deadlift']);
  });

  it('reads a vocabulary phrase as one more variant', () => {
    const plan = buildSearchPlan('pec deck', TAXONOMY);
    expect(plan.variants).toHaveLength(2);
    expect(plan.variants[1][0].forms.map((f) => f.text)).toEqual([
      'pec deck',
      'butterfly',
    ]);
  });

  it.each([
    ['back', ['m-lats', 'm-middle_back', 'm-lower_back', 'm-traps']],
    [
      'legs',
      [
        'm-quadriceps',
        'm-hamstrings',
        'm-glutes',
        'm-calves',
        'm-adductors',
        'm-abductors',
      ],
    ],
    ['piept', ['m-chest']],
    ['quads', ['m-quadriceps']],
    ['spate', ['m-lats', 'm-middle_back', 'm-lower_back', 'm-traps']],
  ])('resolves "%s" to the muscles it names', (query, ids) => {
    expect(
      [...buildSearchPlan(query, TAXONOMY).variants[0][0].muscleIds].sort(),
    ).toEqual([...ids].sort());
  });

  it('resolves equipment by any of its names', () => {
    expect(
      buildSearchPlan('gantere', TAXONOMY).variants[0][0].equipmentIds,
    ).toEqual(['e-dumbbell']);
    expect(buildSearchPlan('db', TAXONOMY).variants[0][0].equipmentIds).toEqual(
      ['e-dumbbell'],
    );
  });

  it('only allows close spellings for longer words', () => {
    expect(buildSearchPlan('deck', TAXONOMY).variants[0][0].fuzzy).toBe(false);
    expect(buildSearchPlan('dumbell', TAXONOMY).variants[0][0].fuzzy).toBe(
      true,
    );
  });
});

describe('searchWhereSql', () => {
  const escape = (value: string) => `'${value.replace(/'/g, "''")}'`;

  it('matches nothing when nothing searchable was typed', () => {
    expect(searchWhereSql(buildSearchPlan('%%!', TAXONOMY), escape)).toBe(
      'FALSE',
    );
  });

  it('matches word starts, words typed together and close spellings', () => {
    const sql = searchWhereSql(buildSearchPlan('pushups', TAXONOMY), escape);
    expect(sql).toContain(`"Exercise".search_name LIKE 'pushups%'`);
    expect(sql).toContain(`"Exercise".search_name LIKE '% pushup%'`);
    expect(sql).toContain(`"Exercise".search_name ~ '(^| )p ?u ?s ?h ?u ?p'`);
    expect(sql).toContain(`'pushups' <% "Exercise".search_name`);
  });

  it('matches the muscles a word names', () => {
    const sql = searchWhereSql(buildSearchPlan('chest', TAXONOMY), escape);
    expect(sql).toContain(
      `em.role IN ('PRIMARY', 'SECONDARY') AND em.muscle_id IN ('m-chest')`,
    );
  });
});

describe('rankExercises (golden queries)', () => {
  it('puts the staple ahead of niche variants: "deadlift"', () => {
    const top = search('deadlift');
    expect(top[0]).toBe('seed-deadlift');
    expect(top.slice(0, 3)).toEqual(
      expect.arrayContaining(['romanian-deadlift', 'barbell-deadlift']),
    );
    expect(top.indexOf('axle-deadlift')).toBeGreaterThan(4);
    expect(top.indexOf('car-deadlift')).toBeGreaterThan(4);
  });

  it('treats a plural like its singular: "squat" and "squats"', () => {
    expect(search('squats').slice(0, 3)).toEqual(search('squat').slice(0, 3));
    expect(search('squats').slice(0, 3)).toContain('barbell-squat');
    expect(search('squats').indexOf('jefferson-squats')).toBeGreaterThan(2);
  });

  it('reads "pushup", "push up" and "push-up" as one search', () => {
    const pushup = search('pushup');
    expect(new Set(search('push up'))).toEqual(new Set(pushup));
    expect(search('push-up')).toEqual(search('push up'));
    expect(pushup[0]).toBe('pushups');
  });

  it('keeps unrelated rows out of "pull up"', () => {
    const top = search('pull up');
    expect(top[0]).toBe('pullups');
    expect(top).not.toContain('band-good-morning-pull-through');
    expect(top).not.toContain('pull-through');
  });

  it('understands shorthand: "rdl", "ohp", "db row"', () => {
    expect(search('rdl')[0]).toBe('romanian-deadlift');
    expect([
      'standing-military-press',
      'barbell-shoulder-press',
      'dumbbell-shoulder-press',
    ]).toContain(search('ohp')[0]);
    expect(search('db row').slice(0, 2).sort()).toEqual(
      ['bent-over-two-dumbbell-row', 'one-arm-dumbbell-row'].sort(),
    );
  });

  it('finds flyes for "chest fly", not shoulder flyes', () => {
    const top = search('chest fly');
    expect(top).toEqual(
      expect.arrayContaining([
        'dumbbell-flyes',
        'cable-crossover',
        'butterfly',
      ]),
    );
    expect(top).not.toContain('reverse-flyes');
  });

  it('ranks chest exercises above stretches for "chest"', () => {
    const top = search('chest');
    expect(top.slice(0, 3)).toEqual(
      expect.arrayContaining([
        'barbell-bench-press-medium-grip',
        'dumbbell-bench-press',
      ]),
    );
    expect(top.indexOf('behind-head-chest-stretch')).toBeGreaterThan(3);
  });

  it('prefers what works the body part over a name that only mentions it: "back"', () => {
    const top = search('back');
    expect(top.indexOf('bent-over-barbell-row')).toBeLessThan(
      top.indexOf('seed-back-squat'),
    );
  });

  it('combines a muscle and equipment: "dumbbell chest"', () => {
    const top = search('dumbbell chest');
    expect(top.slice(0, 2).sort()).toEqual(
      ['dumbbell-bench-press', 'dumbbell-flyes'].sort(),
    );
    expect(top).toContain('incline-dumbbell-press');
    expect(top).not.toContain('barbell-bench-press-medium-grip');
  });

  it('matches words in any order: "bench incline"', () => {
    expect(search('bench incline')[0]).toBe(
      'barbell-incline-bench-press-medium-grip',
    );
  });

  it('forgives a misspelling: "dumbell press"', () => {
    expect(search('dumbell press').slice(0, 2)).toEqual(
      expect.arrayContaining([
        'dumbbell-bench-press',
        'dumbbell-shoulder-press',
      ]),
    );
  });

  it('knows other names for a movement: "skull crusher", "pec deck"', () => {
    expect(search('skull crusher')).toEqual(
      expect.arrayContaining(['lying-triceps-press', 'ez-bar-skullcrusher']),
    );
    expect(search('pec deck')).toEqual(['butterfly']);
  });

  it('searches Romanian names: "genuflexiuni", "flotari", "piept"', () => {
    expect(search('genuflexiuni', { locale: 'ro' }).slice(0, 2)).toEqual(
      expect.arrayContaining(['barbell-squat', 'goblet-squat']),
    );
    expect(search('flotare', { locale: 'ro' })[0]).toBe('pushups');
    expect(search('piept', { locale: 'ro' }).slice(0, 2)).toEqual(
      expect.arrayContaining([
        'barbell-bench-press-medium-grip',
        'dumbbell-bench-press',
      ]),
    );
  });

  it("lifts the searcher's own exercise above a more popular equal match", () => {
    expect(search('squat')[0]).not.toBe('box-squat');
    expect(search('squat', { personal: { 'box-squat': 0.9 } })[0]).toBe(
      'box-squat',
    );
  });
});

describe('personalScore', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it('grows with sessions and fades with time', () => {
    const recent = personalScore(
      {
        exerciseId: 'x',
        sessions: 5,
        lastPerformedAt: daysAgo(1),
        planned: false,
      },
      now,
    );
    const once = personalScore(
      {
        exerciseId: 'x',
        sessions: 1,
        lastPerformedAt: daysAgo(1),
        planned: false,
      },
      now,
    );
    const old = personalScore(
      {
        exerciseId: 'x',
        sessions: 5,
        lastPerformedAt: daysAgo(180),
        planned: false,
      },
      now,
    );
    expect(recent).toBeGreaterThan(once);
    expect(recent).toBeGreaterThan(old);
    expect(old).toBeCloseTo(recent / 4, 2);
    expect(recent).toBeLessThanOrEqual(1);
  });

  it('gives a planned exercise a floor', () => {
    expect(
      personalScore(
        { exerciseId: 'x', sessions: 0, lastPerformedAt: null, planned: true },
        now,
      ),
    ).toBe(0.4);
    expect(
      personalScore(
        { exerciseId: 'x', sessions: 0, lastPerformedAt: null, planned: false },
        now,
      ),
    ).toBe(0);
  });
});
