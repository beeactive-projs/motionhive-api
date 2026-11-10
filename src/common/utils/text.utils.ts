import sanitizeHtml from 'sanitize-html';

// Regex that matches zero-width / format chars (U+200B..U+200D and U+FEFF).
// Built from char codes so the source has no irregular whitespace itself.
const ZERO_WIDTH_RX = new RegExp(
  `[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d)}${String.fromCharCode(0xfeff)}]`,
  'g',
);

/**
 * Strip ALL HTML/script content from user-supplied text, leaving plain
 * text. Use at the **service** layer before persisting fields that are
 * later rendered into HTML emails, notifications, or public pages.
 *
 * Stricter than `escapeHtml` (which keeps the markup as text). Use:
 *   - `stripHtml` for fields stored as plain text (title, description, etc.)
 *   - `escapeHtml` for rendering trusted-stored text into HTML output.
 *
 * Whitespace is collapsed but newlines are preserved (so multi-paragraph
 * descriptions still read).
 */
export function stripHtml(
  input: string | null | undefined,
  maxLength?: number,
): string {
  if (input == null) return '';
  const cleaned = sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    // Defeat hidden-char tricks (leading ZWSP, etc.) that bypass simple
    // length checks while looking empty in the UI.
    textFilter: (text: string) => text.replace(ZERO_WIDTH_RX, ''),
  })
    // Run of horizontal whitespace (space, tab, form-feed, vertical-tab)
    // collapses to a single space. Newlines preserved.
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (maxLength != null && cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength);
  }
  return cleaned;
}

/**
 * How an email address is stored and compared: trimmed and lowercased, so
 * "Ana@Example.com " and "ana@example.com" are one person. (The local part
 * is case sensitive in theory; no provider we deal with treats it so.)
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
