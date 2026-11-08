/**
 * SQL for the categories a coach, a group or a person holds (migration
 * 081), written once for every service that reads or filters by them. Pure
 * strings with no Nest or entity imports, so the profile, group, session and
 * user modules can use them without importing any module.
 *
 * `ownerRef` is a column expression or a named replacement written in code
 * (`"Group"."id"`, `:userId`), never input. Category ids that come from a
 * request only go in through the caller's `escape` (`sequelize.escape`).
 */
const CATEGORY_LINKS = {
  /** What a coach coaches, keyed by the coach's user id. */
  coach: { table: 'coach_category', key: 'user_id' },
  /** What a group trains. */
  group: { table: 'group_category', key: 'group_id' },
  /** What a person likes to train (activities and goals). */
  interest: { table: 'user_interest', key: 'user_id' },
} as const;

export type CategoryLink = keyof typeof CATEGORY_LINKS;

/** One owner's categories: which link they sit in, and the owner's id there. */
export interface CategorySource {
  link: CategoryLink;
  ownerRef: string;
}

/** The list's own order: activities before goals, then display order. */
const LIST_ORDER = 'c.kind, c.display_order';

/**
 * The owner's category ids as a JSON array in the list's order, or NULL
 * when there are none (for a `COALESCE` that falls back to another link).
 */
export function categoryIdsOrNullSql(
  link: CategoryLink,
  ownerRef: string,
): string {
  const { table, key } = CATEGORY_LINKS[link];
  return `(SELECT json_agg(x.category_id ORDER BY ${LIST_ORDER})
    FROM ${table} x JOIN category c ON c.id = x.category_id
    WHERE x.${key} = ${ownerRef})`;
}

/** The owner's category ids as a JSON array in the list's order, `[]` when none. */
export function categoryIdsSql(link: CategoryLink, ownerRef: string): string {
  return `COALESCE(${categoryIdsOrNullSql(link, ownerRef)}, '[]'::json)`;
}

/**
 * The owner's categories as rows in the list's order, for a raw
 * `SELECT` (the data export). `x` is the link row, `c` the category.
 */
export function categoryRowsSql(
  link: CategoryLink,
  ownerRef: string,
  columns: string,
): string {
  const { table, key } = CATEGORY_LINKS[link];
  return `SELECT ${columns}
    FROM ${table} x JOIN category c ON c.id = x.category_id
    WHERE x.${key} = ${ownerRef}
    ORDER BY ${LIST_ORDER}`;
}

/**
 * Whether the owner holds any of `ids`: a Discover filter ("any of these
 * categories"). Each id is quoted by `escape`; an empty list matches
 * nothing, so a caller that means "no filter" leaves the condition out.
 */
export function hasAnyCategorySql(
  link: CategoryLink,
  ownerRef: string,
  ids: readonly string[],
  escape: (value: string) => string,
): string {
  if (ids.length === 0) {
    return 'false';
  }
  const { table, key } = CATEGORY_LINKS[link];
  const wanted = ids.map((id) => escape(id)).join(', ');
  return `EXISTS (SELECT 1 FROM ${table} x
    WHERE x.${key} = ${ownerRef} AND x.category_id IN (${wanted}))`;
}

/**
 * The categories of something that takes them from the first of several
 * owners that has any (a session shows its group's, else its coach's): a
 * JSON array of ids in the list's order, `[]` when none has any.
 */
export function firstCategoryIdsSql(
  sources: readonly CategorySource[],
): string {
  const parts = sources.map((source) =>
    categoryIdsOrNullSql(source.link, source.ownerRef),
  );
  parts.push(`'[]'::json`);
  return `COALESCE(${parts.join(', ')})`;
}

/**
 * Whether the ids `firstCategoryIdsSql` shows for the same sources hold any
 * of `ids`. The first source that has categories decides, as in the
 * `COALESCE`, so what a row shows and what the filter matches always agree.
 * Each id is quoted by `escape`; an empty list matches nothing.
 */
export function firstHasAnyCategorySql(
  sources: readonly CategorySource[],
  ids: readonly string[],
  escape: (value: string) => string,
): string {
  if (sources.length === 0 || ids.length === 0) {
    return 'false';
  }
  const [source, ...rest] = sources;
  const matches = hasAnyCategorySql(source.link, source.ownerRef, ids, escape);
  if (rest.length === 0) {
    return matches;
  }
  return `(${matches} OR (NOT ${hasCategoriesSql(source)} AND ${firstHasAnyCategorySql(rest, ids, escape)}))`;
}

/** Whether the owner holds any category at all. */
function hasCategoriesSql(source: CategorySource): string {
  const { table, key } = CATEGORY_LINKS[source.link];
  return `EXISTS (SELECT 1 FROM ${table} x WHERE x.${key} = ${source.ownerRef})`;
}
