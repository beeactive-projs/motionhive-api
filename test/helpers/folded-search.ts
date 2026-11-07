/**
 * The SQL `foldedContains` (common/utils/search.utils) writes for a column
 * and a term, for specs that check which column a search reads. `term` is
 * the normalized term as it sits inside the quotes (already doubled `'`).
 * The term is folded first and escaped for LIKE after, in SQL.
 */
export function foldedLike(column: string, term: string): string {
  const folded = `fold_for_search('${term}')`;
  const literalTerm = `replace(replace(replace(${folded}, '\\', '\\\\'), '%', '\\%'), '_', '\\_')`;
  return `fold_for_search(${column}) LIKE ('%' || ${literalTerm} || '%')`;
}
