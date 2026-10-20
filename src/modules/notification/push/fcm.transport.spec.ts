import { normalizePrivateKey } from './fcm.transport';

describe('normalizePrivateKey', () => {
  const PEM =
    '-----BEGIN PRIVATE KEY-----\nMIIEv\nQIDAQAB\n-----END PRIVATE KEY-----\n';

  it('turns the one-line \\n form from Railway into real line breaks', () => {
    const oneLine =
      '-----BEGIN PRIVATE KEY-----\\nMIIEv\\nQIDAQAB\\n-----END PRIVATE KEY-----\\n';
    expect(normalizePrivateKey(oneLine)).toBe(PEM);
  });

  it('drops the quotes that come along when pasting from the JSON file', () => {
    const pasted =
      '"-----BEGIN PRIVATE KEY-----\\nMIIEv\\nQIDAQAB\\n-----END PRIVATE KEY-----\\n"';
    expect(normalizePrivateKey(pasted)).toBe(PEM);
  });

  it('keeps a key that already has real line breaks, minus stray whitespace', () => {
    expect(normalizePrivateKey(`  ${PEM}  \n`)).toBe(PEM);
  });

  it('treats a missing or empty value as not configured', () => {
    expect(normalizePrivateKey(undefined)).toBeNull();
    expect(normalizePrivateKey('   ')).toBeNull();
    expect(normalizePrivateKey('""')).toBeNull();
  });
});
