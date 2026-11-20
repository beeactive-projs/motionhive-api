/**
 * What can be sent into a chat as a card (docs/research/messaging/
 * SHARE_IN_MESSAGES.md). Only public things: an open session, a public
 * group, a coach in the directory, a public exercise, a MotionHive starter.
 *
 * Adding a type: a value here and in `chk_message_attachment_type`
 * (migration 092), a target in `share-targets.ts`, a card body in the apps.
 */
export const ShareTargetType = {
  Session: 'SESSION',
  Group: 'GROUP',
  Coach: 'COACH',
  Exercise: 'EXERCISE',
  Program: 'PROGRAM',
} as const;
export type ShareTargetType =
  (typeof ShareTargetType)[keyof typeof ShareTargetType];

export const SHARE_TARGET_TYPES = Object.values(ShareTargetType);

/**
 * AVAILABLE: public now, drawn in full. ENDED: a session that is over.
 * UNAVAILABLE: gone, or no longer public; never says which.
 */
export const ShareCardState = {
  Available: 'AVAILABLE',
  Ended: 'ENDED',
  Unavailable: 'UNAVAILABLE',
} as const;
export type ShareCardState =
  (typeof ShareCardState)[keyof typeof ShareCardState];

/** A thing to share: its type and its id. Nothing else is stored. */
export interface ShareRef {
  type: ShareTargetType;
  id: string;
}

/** Public JSONB translations, swapped in by ContentLocaleInterceptor. */
type Translations = Record<string, Record<string, unknown>> | null;

export interface SessionCard {
  type: 'SESSION';
  state: 'AVAILABLE' | 'ENDED';
  name: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number | null;
  timezone: string;
  online: boolean;
  /** The venue's name and city; never an address or a meeting link. */
  placeName: string | null;
  placeCity: string | null;
  /** Null: no limit. */
  capacity: number | null;
  confirmedCount: number;
  priceCents: number | null;
  currency: string | null;
}

export interface GroupCard {
  type: 'GROUP';
  state: 'AVAILABLE';
  name: string;
  logoUrl: string | null;
  city: string | null;
  memberCount: number;
  joinPolicy: string;
}

export interface CoachCard {
  type: 'COACH';
  state: 'AVAILABLE';
  /** First and last name, as the card's title. */
  name: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  handle: string | null;
  /** Only when the coach shows their city to everyone. */
  city: string | null;
  takingClients: boolean;
  categoryIds: string[];
}

export interface ExerciseCard {
  type: 'EXERCISE';
  state: 'AVAILABLE';
  name: string;
  translations: Translations;
  thumbnailUrl: string | null;
  level: string | null;
  kind: string | null;
  primaryMuscles: Array<{ commonName: string; translations: Translations }>;
}

export interface ProgramCard {
  type: 'PROGRAM';
  state: 'AVAILABLE';
  name: string;
  translations: Translations;
  /** A routine (one repeatable workout) rather than a multi-week program. */
  isSingleWorkout: boolean;
  level: string | null;
  durationDays: number | null;
  workoutCount: number;
  coverImageUrl: string | null;
}

/** Gone or no longer public: no details at all. */
export interface UnavailableCard {
  type: ShareTargetType;
  state: 'UNAVAILABLE';
  name: null;
}

export type ShareCard =
  | SessionCard
  | GroupCard
  | CoachCard
  | ExerciseCard
  | ProgramCard
  | UnavailableCard;

/** Map key for a ref: `SESSION:<id>`. */
export function shareKey(ref: ShareRef): string {
  return `${ref.type}:${ref.id}`;
}

export function unavailableCard(type: ShareTargetType): UnavailableCard {
  return { type, state: ShareCardState.Unavailable, name: null };
}
