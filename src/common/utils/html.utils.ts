/**
 * Escape the five HTML special characters so user-controlled strings
 * can be safely interpolated into email HTML templates.
 *
 * Usage: any `${name}`, `${title}`, `${message}` (or similar) that
 * originates from user input MUST be wrapped in `escapeHtml()` before
 * being concatenated into an HTML template. Without this a malicious
 * name like `<img src=x onerror=...>` renders as live markup in the
 * recipient's webmail client (Gmail, Outlook web, Apple Mail web).
 *
 * Returns the empty string for null/undefined so templates can safely
 * use `${escapeHtml(maybeName)}` without extra guards.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (value == null) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
