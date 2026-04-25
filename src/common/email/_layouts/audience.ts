/**
 * Audience theming hooks — reserved for future use.
 *
 * Today every email shares one shell. Tomorrow we may want to
 * differentiate: instructor-facing emails could carry a "Coach
 * Workspace" footer note, client-facing emails could lean warmer in
 * tone or carry a different CTA color, branded gym partnerships
 * could swap the accent colour.
 *
 * Templates that need to differentiate accept an `audience: Audience`
 * parameter and pick from this map. Adding it as an empty placeholder
 * now means later we can introduce variants without churning every
 * template signature — they just gain an optional argument.
 *
 * Keep this minimal: anything more elaborate (per-audience layouts,
 * per-audience footer links) belongs in a `theme.ts` once we know
 * we actually need it. YAGNI until then.
 */

export type Audience = 'CLIENT' | 'INSTRUCTOR' | 'GUEST';

export interface AudienceTheme {
  /** Footer note tail; null = use the default `© year MotionHive`. */
  footerNote: string | null;
}

export const AUDIENCE_THEMES: Record<Audience, AudienceTheme> = {
  CLIENT: { footerNote: null },
  INSTRUCTOR: { footerNote: null },
  GUEST: { footerNote: null },
};
