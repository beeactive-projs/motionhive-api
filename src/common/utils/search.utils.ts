import { literal, Op } from 'sequelize';

/**
 * Letters a decomposition keeps whole that Postgres `unaccent` spells in
 * plain Latin, so a term folded here matches what `fold_for_search()` does
 * to a column (and what the app's `foldForSearch` does in memory).
 */
const LETTER_FOLDS: Readonly<Record<string, string>> = {
  ß: 'ss',
  ẞ: 'SS',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  æ: 'ae',
  Æ: 'AE',
  ø: 'o',
  Ø: 'O',
  œ: 'oe',
  Œ: 'OE',
};

/**
 * Normalize a search term for consistent matching:
 * - Trims whitespace
 * - Strips diacritics/accents (e.g. "José" → "Jose", "Ștefan" → "Stefan")
 *   and spells out ß ł đ æ ø œ, as `unaccent` does
 * - Folds compatibility forms (NFKD), so a fullwidth ％ is a plain % and
 *   gets escaped like one
 * - Collapses multiple spaces into one
 */
export function normalizeSearchTerm(term: string): string {
  return term
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ßẞłŁđĐæÆøØœŒ]/g, (letter) => LETTER_FOLDS[letter])
    .replace(/\s+/g, ' ');
}

/**
 * Escape the characters LIKE treats as wildcards, so a term is matched
 * literally. Without it a search for `%` matches every row and `_`
 * matches any character, which reads as a broken search and makes an
 * unindexed full scan trivial to trigger.
 */
export function escapeLikeWildcards(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Build a SQL LIKE wildcard term from a raw search input.
 * Returns the normalized, escaped term wrapped in `%...%`.
 */
export function buildSearchTerm(rawTerm: string): string {
  return `%${escapeLikeWildcards(normalizeSearchTerm(rawTerm))}%`;
}

/**
 * A "contains" blind to accents and case on both sides, for a where clause:
 * `fold_for_search(<sql>) LIKE fold_for_search('%term%')`. The column and
 * the term both lose accents and case (unaccent + lower, migration 063), so
 * "stefan" finds "Ștefan" and "Ștefan" still finds "Stefan". Folding only
 * the typed term, as `buildSearchTerm` alone does, made accented input miss
 * accented names. Group, exercise and program search use the same function.
 *
 * `sql` is a column expression written in code, never input. The term is
 * quoted by `escape` (the caller's `sequelize.escape`), folded, and only
 * then escaped for LIKE, in SQL: `unaccent` turns a fullwidth ％ ＿ ＼ into
 * % _ \, so a term escaped before the fold got its wildcards back and a
 * typed ％％ matched every row.
 */
export function foldedContains(
  sql: string,
  rawTerm: string,
  escape: (value: string) => string,
): ReturnType<typeof literal> {
  return literal(foldedContainsSql(sql, rawTerm, escape));
}

/**
 * `foldedContains` as plain SQL, for a condition built from several of
 * them (one column OR an `EXISTS` over another table). Same rules: `sql` is
 * code, the term is quoted by `escape`, folded, then LIKE-escaped in SQL.
 */
export function foldedContainsSql(
  sql: string,
  rawTerm: string,
  escape: (value: string) => string,
): string {
  const folded = `fold_for_search(${escape(normalizeSearchTerm(rawTerm))})`;
  const literalTerm = `replace(replace(replace(${folded}, '\\', '\\\\'), '%', '\\%'), '_', '\\_')`;
  return `fold_for_search(${sql}) LIKE ('%' || ${literalTerm} || '%')`;
}

/**
 * Build an Op.or array of iLike conditions for the given fields.
 * Normalizes the search term once and applies it to all fields.
 *
 * @example
 * buildILikeConditions('yoga', ['title', 'description'])
 * // → { [Op.or]: [{ title: { [Op.iLike]: '%yoga%' } }, { description: { [Op.iLike]: '%yoga%' } }] }
 */
export function buildILikeConditions(
  rawTerm: string,
  fields: string[],
): Record<symbol, Array<Record<string, Record<symbol, string>>>> {
  const term = buildSearchTerm(rawTerm);
  return {
    [Op.or]: fields.map((field) => ({ [field]: { [Op.iLike]: term } })),
  };
}
