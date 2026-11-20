/**
 * The names a new program is born with in the mobile builder, one per
 * language the app speaks. A draft still wearing one has not been named by
 * anyone, so it cannot be published.
 *
 * Copied from beeactive-ui `projects/mobile/public/i18n/en.json` and
 * `ro.json`, key `programs.builder.untitledProgram`. Change them together.
 */
export const UNTITLED_PROGRAM_NAMES: readonly string[] = [
  'Untitled program',
  'Program fără titlu',
];

/** A name someone gave it: not empty, and not the untouched default. */
export function hasUsableProgramName(name: string | null | undefined): boolean {
  if (!name) {
    return false;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return false;
  }
  return !UNTITLED_PROGRAM_NAMES.includes(trimmed);
}
