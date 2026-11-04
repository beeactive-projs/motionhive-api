import {
  escapeLikeWildcards,
  normalizeSearchTerm,
} from '../../../common/utils/search.utils';
import {
  MUSCLE_GROUP_TERMS,
  SEARCH_STOPWORDS,
  SEARCH_SYNONYMS,
} from './exercise-search.vocabulary';

/**
 * Exercise search: what a query matches (a SQL condition) and how the
 * matches are ordered (a score computed here, in code, so it can be tested
 * against real queries). Pure: no DB access. `ExerciseSearchService` loads
 * the taxonomy and the searcher's history; `ExerciseService.list` runs the
 * condition and pages the ranked ids.
 *
 * A query is split into words. Every word has to match, in any order
 * ("bench incline" finds "Incline Bench Press"), and a word matches an
 * exercise when:
 *   - a word of its name, in any language, starts with it ("squat" finds
 *     "squats", "fly" finds "flyes"), or with one of its stems ("squats"
 *     finds "squat") or synonyms ("db" finds "dumbbell");
 *   - it is words of the name typed together ("pushup" finds "Push-Up");
 *   - it names a muscle or a muscle group the exercise works ("chest",
 *     "legs", "spate"), or equipment it uses ("dumbbell", "gantere");
 *   - it is a close spelling of a word of the name ("dumbell").
 * The whole query typed together also matches ("push up" finds "Pushups").
 * Typed-together matches start at a word of the name, so "chin" does not
 * hide in "stretCH INtindere".
 */

/** Lowercase, no diacritics, letters and digits in single spaces: the code side of `search_words()` (migration 080). */
export function searchWords(input: string): string {
  return normalizeSearchTerm(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ── Ranking weights ───────────────────────────────────────────────────

/** How much each signal counts in the final score. Text leads; a person's own use outweighs everyone's. */
export const RANKING_WEIGHTS = {
  text: 1,
  personal: 0.5,
  popularity: 0.4,
} as const;

/** How well one word of the query matched, best first. */
const STRENGTH = {
  exactWord: 1,
  wordStart: 0.9,
  primaryMuscle: 1,
  compact: 0.8,
  equipment: 0.6,
  fuzzy: 0.6,
  secondaryMuscle: 0.45,
} as const;

/** A stem or a synonym is a slightly weaker match than the word as typed. */
const DERIVED_FORM_WEIGHT = 0.95;
/** A body-part word found in the name of an exercise that does not work that body part. */
const OTHER_MUSCLE_NAME_WEIGHT = 0.8;
/** Floor for a word that only the database's close match accepted. */
const FUZZY_FLOOR = 0.3;
/** Score for a row matched only by the whole query typed together. */
const COMPACT_ONLY = 0.8;
/** The name is exactly what was typed (or a synonym of it). */
const EXACT_NAME_BONUS = 0.25;
/** The name starts with what was typed. */
const NAME_START_BONUS = 0.05;
/** Scaled by the share of the name's words that the query covers: "Deadlift" beats "Kettlebell One-Legged Deadlift". */
const COVERAGE_BONUS = 0.25;

/** Shortest text worth a typed-together match; shorter ones match half the library. */
const MIN_COMPACT = 4;
/** Shortest word worth a close-spelling match; at four letters "deck" already reads as "decline". */
const MIN_FUZZY = 5;
/** Shortest word that names a muscle or equipment by its start ("tri", "quad"). */
const MIN_TAXONOMY_PREFIX = 3;
/** Longest vocabulary phrase, in words. */
const MAX_PHRASE_WORDS = 3;
/** Bound on the alternative readings of one query. */
const MAX_VARIANTS = 4;
/** Bound on the exact-name spellings tried for one query. */
const MAX_EXACT_KEYS = 32;

// ── Plan ──────────────────────────────────────────────────────────────

export interface SearchTaxonomyEntry {
  id: string;
  slug: string;
  /** Every name it goes by: English, Latin, each translation. Folded here. */
  names: readonly string[];
}

export interface SearchTaxonomy {
  muscles: readonly SearchTaxonomyEntry[];
  equipment: readonly SearchTaxonomyEntry[];
}

export interface SearchForm {
  /** Folded words, space separated. */
  text: string;
  words: readonly string[];
  /** `text` without spaces. */
  compact: string;
  /** 1 for what was typed, less for a stem or a synonym. */
  weight: number;
}

export interface SearchToken {
  /** What was typed, folded: one word, or a vocabulary phrase. */
  word: string;
  forms: readonly SearchForm[];
  /** A close spelling counts (single words of `MIN_FUZZY`+ letters). */
  fuzzy: boolean;
  muscleIds: readonly string[];
  equipmentIds: readonly string[];
}

export interface ExerciseSearchPlan {
  /** The query, folded, without stopwords. Empty when nothing searchable was typed. */
  text: string;
  /** `text` without spaces. */
  compact: string;
  /**
   * Readings of the query, each a list of tokens that must all match. The
   * first is word by word; the others replace a vocabulary phrase with its
   * synonyms ("pec deck" → "butterfly").
   */
  variants: readonly (readonly SearchToken[])[];
  /** Spaceless names, without a plural s, that count as exactly what was typed. */
  exactKeys: ReadonlySet<string>;
  /** Name starts that count as "starts with what was typed". */
  startKeys: readonly string[];
}

/** Turn what was typed into what to match. */
export function buildSearchPlan(
  raw: string,
  taxonomy: SearchTaxonomy,
): ExerciseSearchPlan {
  const folded = searchWords(raw);
  const all = folded ? folded.split(' ') : [];
  const content = all.filter((word) => !SEARCH_STOPWORDS.has(word));
  const words = content.length ? content : all;
  const text = words.join(' ');

  const resolver = new TaxonomyResolver(taxonomy);
  const variants: SearchToken[][] = [];
  if (words.length) {
    variants.push(words.map((word) => wordToken(word, resolver)));
    for (const phrase of vocabularyPhrases(words)) {
      if (variants.length >= MAX_VARIANTS) break;
      const token = phraseToken(phrase.text, resolver);
      if (!token) continue;
      variants.push([
        ...words.slice(0, phrase.start).map((w) => wordToken(w, resolver)),
        token,
        ...words.slice(phrase.end).map((w) => wordToken(w, resolver)),
      ]);
    }
  }

  const exactKeys = new Set<string>();
  const startKeys = new Set<string>();
  for (const variant of variants) {
    for (const spelling of spellings(variant)) {
      if (exactKeys.size >= MAX_EXACT_KEYS) break;
      exactKeys.add(withoutPlural(spelling.replace(/ /g, '')));
      startKeys.add(spelling);
    }
  }

  return {
    text,
    compact: text.replace(/ /g, ''),
    variants,
    exactKeys,
    startKeys: [...startKeys],
  };
}

function wordToken(word: string, resolver: TaxonomyResolver): SearchToken {
  const forms = new Map<string, SearchForm>();
  const add = (value: string, weight: number) => {
    const formText = searchWords(value);
    if (!formText || forms.has(formText)) return;
    forms.set(formText, makeForm(formText, weight));
  };

  add(word, 1);
  const stems = stemsOf(word);
  for (const stem of stems) add(stem, DERIVED_FORM_WEIGHT);
  for (const base of [word, ...stems]) {
    for (const synonym of SEARCH_SYNONYMS[base] ?? []) {
      add(synonym, DERIVED_FORM_WEIGHT);
    }
  }

  const formList = [...forms.values()];
  return {
    word,
    forms: formList,
    fuzzy: word.length >= MIN_FUZZY && !/^\d+$/.test(word),
    muscleIds: resolver.muscles(formList),
    equipmentIds: resolver.equipment(formList),
  };
}

/** A vocabulary phrase read as one token, or null when it means nothing more than its words. */
function phraseToken(
  phrase: string,
  resolver: TaxonomyResolver,
): SearchToken | null {
  const synonyms = SEARCH_SYNONYMS[phrase] ?? [];
  const muscleIds = resolver.group(phrase);
  if (!synonyms.length && !muscleIds.length) return null;
  return {
    word: phrase,
    forms: [
      makeForm(phrase, 1),
      ...synonyms.map((synonym) =>
        makeForm(searchWords(synonym), DERIVED_FORM_WEIGHT),
      ),
    ],
    fuzzy: false,
    muscleIds,
    equipmentIds: [],
  };
}

function makeForm(text: string, weight: number): SearchForm {
  return {
    text,
    words: text.split(' '),
    compact: text.replace(/ /g, ''),
    weight,
  };
}

/**
 * Shorter spellings a word may hide behind: a plural s or es ("squats",
 * "flyes"), and for Romanian a final vowel ("flotare" finds "flotari").
 * Matched as word starts, so "fly" already finds "flyes" without one.
 */
function stemsOf(word: string): string[] {
  const stems: string[] = [];
  if (word.length >= 4 && word.endsWith('s') && !word.endsWith('ss')) {
    stems.push(word.slice(0, -1));
  }
  if (word.length >= 5 && word.endsWith('es')) stems.push(word.slice(0, -2));
  if (word.length >= 5 && /[aeiou]$/.test(word)) stems.push(word.slice(0, -1));
  return stems;
}

function withoutPlural(compact: string): string {
  return compact.length > 3 && compact.endsWith('s') && !compact.endsWith('ss')
    ? compact.slice(0, -1)
    : compact;
}

/** Multi-word vocabulary keys found in the query, longest first. */
function vocabularyPhrases(
  words: readonly string[],
): Array<{ text: string; start: number; end: number }> {
  const found: Array<{ text: string; start: number; end: number }> = [];
  for (let size = Math.min(MAX_PHRASE_WORDS, words.length); size >= 2; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      const text = words.slice(start, start + size).join(' ');
      if (SEARCH_SYNONYMS[text] || MUSCLE_GROUP_TERMS[text]) {
        found.push({ text, start, end: start + size });
      }
    }
  }
  return found;
}

/** Each way of spelling a variant out, one form per token, capped. */
function spellings(tokens: readonly SearchToken[]): string[] {
  let acc = [''];
  for (const token of tokens) {
    const next: string[] = [];
    for (const prefix of acc) {
      for (const form of token.forms) {
        if (next.length >= MAX_EXACT_KEYS) break;
        next.push(prefix ? `${prefix} ${form.text}` : form.text);
      }
    }
    acc = next;
  }
  return tokens.length ? acc : [];
}

/** Which muscles and equipment a word names. */
class TaxonomyResolver {
  private readonly muscleNames: ReadonlyArray<{
    id: string;
    words: string[];
    text: string[];
  }>;
  private readonly equipmentNames: ReadonlyArray<{
    id: string;
    words: string[];
    text: string[];
  }>;
  private readonly muscleIdBySlug: ReadonlyMap<string, string>;

  constructor(taxonomy: SearchTaxonomy) {
    const index = (entries: readonly SearchTaxonomyEntry[]) =>
      entries.map((entry) => {
        const text = entry.names.map(searchWords).filter(Boolean);
        return { id: entry.id, text, words: text.flatMap((n) => n.split(' ')) };
      });
    this.muscleNames = index(taxonomy.muscles);
    // "Other" names nothing anyone searches for.
    this.equipmentNames = index(
      taxonomy.equipment.filter((entry) => entry.slug !== 'other'),
    );
    this.muscleIdBySlug = new Map(taxonomy.muscles.map((m) => [m.slug, m.id]));
  }

  /** Muscles a group word stands for ("legs", "spate"). */
  group(term: string): string[] {
    return (MUSCLE_GROUP_TERMS[term] ?? [])
      .map((slug) => this.muscleIdBySlug.get(slug))
      .filter((id): id is string => !!id);
  }

  muscles(forms: readonly SearchForm[]): string[] {
    const ids = new Set<string>();
    for (const form of forms) {
      for (const id of this.group(form.text)) ids.add(id);
    }
    for (const id of this.byName(this.muscleNames, forms)) ids.add(id);
    return [...ids];
  }

  equipment(forms: readonly SearchForm[]): string[] {
    return this.byName(this.equipmentNames, forms);
  }

  private byName(
    entries: ReadonlyArray<{ id: string; words: string[]; text: string[] }>,
    forms: readonly SearchForm[],
  ): string[] {
    const ids: string[] = [];
    for (const entry of entries) {
      const named = forms.some((form) =>
        form.words.length > 1
          ? entry.text.some((name) => startsAtWord(name, form.text))
          : form.text.length >= MIN_TAXONOMY_PREFIX &&
            entry.words.some((w) => w.startsWith(form.text)),
      );
      if (named) ids.push(entry.id);
    }
    return ids;
  }
}

function startsAtWord(haystack: string, needle: string): boolean {
  return haystack.startsWith(needle) || haystack.includes(` ${needle}`);
}

// ── SQL ───────────────────────────────────────────────────────────────

/**
 * The plan as a WHERE condition on `"Exercise"`. Every value goes through
 * `escape` (the caller's `sequelize.escape`), and forms only ever hold
 * letters, digits and spaces, so LIKE wildcards cannot sneak in. Mirrors
 * `rankExercises`: a row this accepts always gets a score there.
 */
export function searchWhereSql(
  plan: ExerciseSearchPlan,
  escape: (value: string) => string,
): string {
  const name = '"Exercise".search_name';
  // Typed together: the letters from the start of a word, a space allowed
  // between any two ("pushup" → '(^| )p ?u ?s ?h ?u ?p'). Letters and
  // digits only, so nothing in it is a regex operator.
  const together = (compact: string) =>
    `${name} ~ ${escape(`(^| )${compact.split('').join(' ?')}`)}`;

  const formSql = (form: SearchForm) => {
    const value = escapeLikeWildcards(form.text);
    const parts = [
      `${name} LIKE ${escape(`${value}%`)}`,
      `${name} LIKE ${escape(`% ${value}%`)}`,
    ];
    if (form.compact.length >= MIN_COMPACT) parts.push(together(form.compact));
    return parts.join(' OR ');
  };
  const ids = (values: readonly string[]) => values.map(escape).join(',');

  const tokenSql = (token: SearchToken) => {
    const parts = token.forms.map(formSql);
    if (token.fuzzy) parts.push(`${escape(token.word)} <% ${name}`);
    if (token.muscleIds.length) {
      parts.push(
        `EXISTS (SELECT 1 FROM exercise_muscle em WHERE em.exercise_id = "Exercise".id AND em.role IN ('PRIMARY', 'SECONDARY') AND em.muscle_id IN (${ids(token.muscleIds)}))`,
      );
    }
    if (token.equipmentIds.length) {
      parts.push(
        `EXISTS (SELECT 1 FROM exercise_equipment ee WHERE ee.exercise_id = "Exercise".id AND ee.equipment_id IN (${ids(token.equipmentIds)}))`,
      );
    }
    return `(${parts.join(' OR ')})`;
  };

  const alternatives = plan.variants.map(
    (tokens) => `(${tokens.map(tokenSql).join(' AND ')})`,
  );
  if (plan.compact.length >= MIN_COMPACT) {
    alternatives.push(together(plan.compact));
  }
  return alternatives.length ? `(${alternatives.join(' OR ')})` : 'FALSE';
}

// ── Ranking ───────────────────────────────────────────────────────────

export interface RankCandidate {
  id: string;
  /** English name. */
  name: string;
  /** Name in the reader's language (the English one when untranslated). */
  localeName: string;
  /** `exercise.search_name`: every name, folded. */
  searchName: string;
  /** `exercise.popularity_score`, 0 to 1. */
  popularity: number;
  primaryMuscleIds: readonly string[];
  secondaryMuscleIds: readonly string[];
  equipmentIds: readonly string[];
}

/** Ids of the candidates, best match first. `personal` holds the searcher's 0 to 1 score per exercise id. */
export function rankExercises(
  plan: ExerciseSearchPlan,
  candidates: readonly RankCandidate[],
  personal: ReadonlyMap<string, number>,
): string[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreExercise(plan, candidate, personal.get(candidate.id) ?? 0),
      sortName: searchWords(candidate.localeName),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0) ||
        (a.candidate.id < b.candidate.id ? -1 : 1),
    )
    .map((entry) => entry.candidate.id);
}

export function scoreExercise(
  plan: ExerciseSearchPlan,
  candidate: RankCandidate,
  personal: number,
): number {
  return (
    RANKING_WEIGHTS.text * textScore(plan, candidate) +
    RANKING_WEIGHTS.personal * personal +
    RANKING_WEIGHTS.popularity * candidate.popularity
  );
}

function textScore(plan: ExerciseSearchPlan, candidate: RankCandidate): number {
  const docWords = candidate.searchName.split(' ');

  let base = 0;
  for (const tokens of plan.variants) {
    const strengths = tokens.map((token) =>
      tokenStrength(token, docWords, candidate),
    );
    if (strengths.length && strengths.every((s) => s > 0)) {
      base = Math.max(base, mean(strengths));
    }
  }
  if (!base) {
    base =
      plan.compact.length >= MIN_COMPACT &&
      typedTogether(plan.compact, docWords)
        ? COMPACT_ONLY
        : FUZZY_FLOOR;
  }

  return base + nameBonus(plan, candidate);
}

/** The letters, from the start of some word, run over the next words with their spaces taken out. Same rule as the SQL regex. */
function typedTogether(compact: string, docWords: readonly string[]): boolean {
  for (let i = 0; i < docWords.length; i++) {
    let run = '';
    for (let j = i; j < docWords.length && run.length < compact.length; j++) {
      run += docWords[j];
    }
    if (run.startsWith(compact)) return true;
  }
  return false;
}

function tokenStrength(
  token: SearchToken,
  docWords: readonly string[],
  candidate: RankCandidate,
): number {
  let best = 0;
  for (const form of token.forms) {
    const hit = phraseHit(form.words, docWords);
    if (hit === 'exact')
      best = Math.max(best, STRENGTH.exactWord * form.weight);
    else if (hit === 'start')
      best = Math.max(best, STRENGTH.wordStart * form.weight);
    if (
      form.compact.length >= MIN_COMPACT &&
      typedTogether(form.compact, docWords)
    ) {
      best = Math.max(best, STRENGTH.compact * form.weight);
    }
  }
  if (token.muscleIds.length) {
    const works = (ids: readonly string[]) =>
      ids.some((id) => token.muscleIds.includes(id));
    if (works(candidate.primaryMuscleIds)) {
      best = Math.max(best, STRENGTH.primaryMuscle);
    } else if (works(candidate.secondaryMuscleIds)) {
      best = Math.max(best, STRENGTH.secondaryMuscle);
    } else {
      // The word names a body part this exercise does not work: "back" in
      // "Back Squat", "arm" in "One-Arm Row". A name hit, but a weaker one.
      best *= OTHER_MUSCLE_NAME_WEIGHT;
    }
  }
  if (
    token.equipmentIds.length &&
    candidate.equipmentIds.some((id) => token.equipmentIds.includes(id))
  ) {
    best = Math.max(best, STRENGTH.equipment);
  }
  if (!best && token.fuzzy) {
    const closest = Math.max(
      0,
      ...docWords.map((word) => trigramSimilarity(token.word, word)),
    );
    best = Math.max(FUZZY_FLOOR, STRENGTH.fuzzy * closest);
  }
  return best;
}

/**
 * Where the form's words sit in the name: `exact` when they are whole words
 * of it, in order; `start` when the last one only starts a word ("squat" in
 * "squats"); null when they are not there. Same rule as the LIKE patterns.
 */
function phraseHit(
  form: readonly string[],
  doc: readonly string[],
): 'exact' | 'start' | null {
  let best: 'exact' | 'start' | null = null;
  for (let i = 0; i + form.length <= doc.length; i++) {
    let ok = true;
    let exact = true;
    for (let j = 0; j < form.length && ok; j++) {
      const word = doc[i + j];
      const last = j === form.length - 1;
      if (word === form[j]) continue;
      if (last && word.startsWith(form[j])) exact = false;
      else ok = false;
    }
    if (!ok) continue;
    if (exact) return 'exact';
    best = 'start';
  }
  return best;
}

function nameBonus(plan: ExerciseSearchPlan, candidate: RankCandidate): number {
  const queryWords = new Set(
    plan.variants.flatMap((tokens) =>
      tokens.flatMap((token) => token.forms.flatMap((form) => form.words)),
    ),
  );
  const names = new Set([candidate.localeName, candidate.name]);
  let best = 0;
  for (const name of names) {
    const all = searchWords(name).split(' ').filter(Boolean);
    const content = all.filter((word) => !SEARCH_STOPWORDS.has(word));
    const words = content.length ? content : all;
    if (!words.length) continue;
    const joined = words.join(' ');

    let bonus = 0;
    if (plan.exactKeys.has(withoutPlural(words.join(''))))
      bonus += EXACT_NAME_BONUS;
    if (plan.startKeys.some((key) => joined.startsWith(key)))
      bonus += NAME_START_BONUS;
    const covered = words.filter((word) =>
      [...queryWords].some((q) => word.startsWith(q)),
    ).length;
    bonus += COVERAGE_BONUS * (covered / words.length);
    best = Math.max(best, bonus);
  }
  return best;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Share of three-letter pieces two words have in common, the way pg_trgm counts them. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

// ── Personal ──────────────────────────────────────────────────────────

export interface PersonalUsage {
  exerciseId: string;
  /** Completed workouts the person did it in (last year). */
  sessions: number;
  lastPerformedAt: Date | null;
  /** In a routine or program they own, or one their coach assigned them. */
  planned: boolean;
}

/** Days for a habit to count half as much. */
const PERSONAL_HALF_LIFE_DAYS = 90;
/** An exercise someone planned but has not done yet still leans their way. */
const PLANNED_FLOOR = 0.4;

/** 0 to 1: how much this exercise is the person's own. Often and lately counts most. */
export function personalScore(usage: PersonalUsage, now: Date): number {
  let logged = 0;
  if (usage.sessions > 0 && usage.lastPerformedAt) {
    const days = Math.max(
      0,
      (now.getTime() - usage.lastPerformedAt.getTime()) / 86_400_000,
    );
    logged =
      (1 - Math.exp(-usage.sessions / 2)) *
      Math.pow(0.5, days / PERSONAL_HALF_LIFE_DAYS);
  }
  return Math.max(logged, usage.planned ? PLANNED_FLOOR : 0);
}
