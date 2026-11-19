import {
  categoryIdsOrNullSql,
  categoryIdsSql,
  categoryRowsSql,
  firstCategoryIdsSql,
  firstHasAnyCategorySql,
  hasAnyCategorySql,
  type CategorySource,
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

  /** Quotes like `sequelize.escape`, and records what went through it. */
  const escape = jest.fn((value: string) => `'${value.replace(/'/g, "''")}'`);

  beforeEach(() => escape.mockClear());

  describe('hasAnyCategorySql', () => {
    it('matches a group holding any of the ids, each one escaped', () => {
      expect(
        squash(
          hasAnyCategorySql(
            'group',
            '"Group"."id"',
            ['cat-a', 'cat-b'],
            escape,
          ),
        ),
      ).toBe(
        'EXISTS (SELECT 1 FROM group_category x ' +
          'WHERE x.group_id = "Group"."id" ' +
          "AND x.category_id IN ('cat-a', 'cat-b'))",
      );
      expect(escape).toHaveBeenCalledWith('cat-a');
      expect(escape).toHaveBeenCalledWith('cat-b');
    });

    it('reads a coach by user id', () => {
      const sql = squash(
        hasAnyCategorySql(
          'coach',
          '"InstructorProfile"."user_id"',
          ['c'],
          escape,
        ),
      );
      expect(sql).toContain('FROM coach_category x');
      expect(sql).toContain('WHERE x.user_id = "InstructorProfile"."user_id"');
    });

    it('never lets an id out of its quotes', () => {
      const sql = hasAnyCategorySql(
        'group',
        '"Group"."id"',
        ["x') OR (1=1"],
        escape,
      );
      expect(sql).toContain("IN ('x'') OR (1=1')");
    });

    it('matches nothing for an empty list, rather than writing IN ()', () => {
      expect(hasAnyCategorySql('group', '"Group"."id"', [], escape)).toBe(
        'false',
      );
    });
  });

  describe('a session: its group, else its coach', () => {
    const sources: CategorySource[] = [
      { link: 'group', ownerRef: '"template"."group_id"' },
      { link: 'coach', ownerRef: '"template"."instructor_id"' },
    ];

    it("shows the first source's ids that has any, [] when none has", () => {
      expect(squash(firstCategoryIdsSql(sources))).toBe(
        squash(
          `COALESCE(${categoryIdsOrNullSql('group', '"template"."group_id"')}, ` +
            `${categoryIdsOrNullSql('coach', '"template"."instructor_id"')}, ` +
            `'[]'::json)`,
        ),
      );
    });

    it('filters by the same rule: the coach only counts when the group has none', () => {
      const group = hasAnyCategorySql(
        'group',
        '"template"."group_id"',
        ['cat-a'],
        escape,
      );
      const coach = hasAnyCategorySql(
        'coach',
        '"template"."instructor_id"',
        ['cat-a'],
        escape,
      );
      expect(squash(firstHasAnyCategorySql(sources, ['cat-a'], escape))).toBe(
        squash(
          `(${group} OR (NOT EXISTS (SELECT 1 FROM group_category x ` +
            `WHERE x.group_id = "template"."group_id") AND ${coach}))`,
        ),
      );
    });

    it('is one plain test for a single source', () => {
      expect(firstHasAnyCategorySql([sources[1]], ['c'], escape)).toBe(
        hasAnyCategorySql('coach', '"template"."instructor_id"', ['c'], escape),
      );
    });

    it('matches nothing for an empty list', () => {
      expect(firstHasAnyCategorySql(sources, [], escape)).toBe('false');
    });
  });
});
