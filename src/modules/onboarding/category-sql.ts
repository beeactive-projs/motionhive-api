/**
 * SQL for the categories a coach, a group or a person holds (migration
 * 081), written once for every service that reads them. Pure strings with
 * no Nest or entity imports, so the profile, group, session and user
 * modules can use them without depending on the onboarding module.
 *
 * `ownerRef` is a column expression or a named replacement written in code
 * (`"Group"."id"`, `:userId`), never input.
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
