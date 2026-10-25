/**
 * Why a coach is in someone's suggestions. Clients label or order a
 * suggestion by it and must ignore a reason they don't know, so new ones
 * can ship without breaking older apps.
 *
 * Only SUGGESTED exists today. Paid placements are planned as SPONSORED:
 * they will be mixed into the same list and marked so the client can say so.
 */
export enum CoachSuggestionReason {
  /** Ranked by the server: same country first, then a photo, then experience. */
  SUGGESTED = 'SUGGESTED',
}
