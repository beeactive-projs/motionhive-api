import {
  categoryIdsOrNullSql,
  categoryIdsSql,
  categoryRowsSql,
} from './category-sql';

const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('category SQL', () => {
  it("reads a coach's ids by user id, in the list's order", () => {
    expect(squash(categoryIdsOrNullSql('coach', '"t"."instructor_id"'))).toBe(
      '(SELECT json_agg(x.category_id ORDER BY c.kind, c.display_order) ' +
        'FROM coach_category x JOIN category c ON c.id = x.category_id ' +
        'WHERE x.user_id = "t"."instructor_id")',
    );
  });

  it("reads a group's ids by group id, [] when there are none", () => {
    const sql = squash(categoryIdsSql('group', '"Group"."id"'));
    expect(sql).toContain('FROM group_category x');
    expect(sql).toContain('WHERE x.group_id = "Group"."id"');
    expect(sql.startsWith('COALESCE(')).toBe(true);
    expect(sql.endsWith(", '[]'::json)")).toBe(true);
  });

  it("lists a person's interests as rows for the export", () => {
    expect(
      squash(categoryRowsSql('interest', ':userId', 'c.slug, x.created_at')),
    ).toBe(
      'SELECT c.slug, x.created_at ' +
        'FROM user_interest x JOIN category c ON c.id = x.category_id ' +
        'WHERE x.user_id = :userId ORDER BY c.kind, c.display_order',
    );
  });
});
