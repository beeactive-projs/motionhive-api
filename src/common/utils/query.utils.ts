/**
 * A query param that may repeat or hold a comma list, as one trimmed list:
 * Express hands back a string for `?x=A`, an array for `?x=A&x=B`, and
 * `?x=A,B` arrives as one string, so all three become `['A', 'B']`. Empty
 * input stays undefined so `@IsOptional` skips it, and non-strings pass
 * through for the validators to reject.
 *
 * Only for values that never hold a comma themselves (ids, enum values):
 * free text keeps its commas and needs a list without the split.
 */
export function toQueryList(value: unknown): unknown[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  const list = raw
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');
  if (list.length === 0) {
    return undefined;
  }
  return list;
}
