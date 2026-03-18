import { Op } from 'sequelize';

/**
 * Normalize a search term for consistent matching:
 * - Trims whitespace
 * - Strips diacritics/accents (e.g. "José" → "Jose", "Ștefan" → "Stefan")
 * - Collapses multiple spaces into one
 */
export function normalizeSearchTerm(term: string): string {
  return term
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Build a SQL LIKE wildcard term from a raw search input.
 * Returns the normalized term wrapped in `%...%`.
 */
export function buildSearchTerm(rawTerm: string): string {
  return `%${normalizeSearchTerm(rawTerm)}%`;
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
