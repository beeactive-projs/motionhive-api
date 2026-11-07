/**
 * How the coach directory orders its rows. Every order ends on the profile
 * id, so a page boundary never falls between two rows that tie.
 */
export enum CoachDirectorySort {
  /** Taking clients first, then the most experienced, then by name. */
  RECOMMENDED = 'recommended',
  /** The most experienced first; a coach who gives no years comes last. */
  EXPERIENCE = 'experience',
  /** By the name the row shows: the display name, else first and last. */
  NAME = 'name',
}
