import {
  buildSearchTerm,
  escapeLikeWildcards,
  foldText,
  foldedContains,
  normalizeSearchTerm,
} from './search.utils';

describe('search.utils', () => {
  describe('escapeLikeWildcards', () => {
    it('escapes the characters LIKE treats as wildcards', () => {
      expect(escapeLikeWildcards('100%')).toBe('100\\%');
      expect(escapeLikeWildcards('a_b')).toBe('a\\_b');
      expect(escapeLikeWildcards('back\\slash')).toBe('back\\\\slash');
    });

    it('leaves an ordinary term untouched', () => {
      expect(escapeLikeWildcards('push day')).toBe('push day');
    });
  });

  describe('buildSearchTerm', () => {
    // A bare % used to match every row, which reads as a broken search
    // and makes an unindexed full scan trivial to trigger.
    it('does not let a wildcard term match everything', () => {
      expect(buildSearchTerm('%')).toBe('%\\%%');
    });

    it('still strips diacritics and collapses whitespace', () => {
      expect(buildSearchTerm('  Ștefan   Pop ')).toBe('%Stefan Pop%');
    });
  });

  describe('foldText', () => {
    it('compares blind to case and accents, as fold_for_search does', () => {
      expect(foldText(' Forță ')).toBe('forta');
      expect(foldText('ȘTEFAN')).toBe(foldText('stefan'));
    });
  });

  describe('normalizeSearchTerm', () => {
    it('trims, strips accents and collapses spaces', () => {
      expect(normalizeSearchTerm('  José   María ')).toBe('Jose Maria');
    });

    it('spells out the letters unaccent does, as the app does in memory', () => {
      expect(normalizeSearchTerm('Straße Łódź Ærø Œuvre Đorđe')).toBe(
        'Strasse Lodz AEro OEuvre Dorde',
      );
    });

    it('reads a fullwidth wildcard as the plain one, so it is escaped like one', () => {
      expect(normalizeSearchTerm('％＿')).toBe('%_');
      expect(buildSearchTerm('％％')).toBe('%\\%\\%%');
    });
  });

  describe('foldedContains', () => {
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const sqlOf = (l: ReturnType<typeof foldedContains>) =>
      (l as unknown as { val: string }).val;

    // The term is folded first and escaped for LIKE after, in SQL.
    const likeTerm = (folded: string) =>
      String.raw`replace(replace(replace(${folded}, '\', '\\'), '%', '\%'), '_', '\_')`;

    it('folds the column and the term alike', () => {
      expect(sqlOf(foldedContains('"User"."handle"', 'Ștefan', quote))).toBe(
        `fold_for_search("User"."handle") LIKE ('%' || ${likeTerm(`fold_for_search('Stefan')`)} || '%')`,
      );
    });

    it('quotes the term and escapes its wildcards only after the fold', () => {
      // unaccent turns a fullwidth ％ into %, so escaping before the fold
      // let ％％ match every row.
      expect(sqlOf(foldedContains('x', "50%_o'k ％", quote))).toBe(
        `fold_for_search(x) LIKE ('%' || ${likeTerm(`fold_for_search('50%_o''k %')`)} || '%')`,
      );
    });
  });
});
