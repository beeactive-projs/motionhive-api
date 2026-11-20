import {
  CoachCard,
  ExerciseCard,
  GroupCard,
  ProgramCard,
  SessionCard,
  ShareCard,
  ShareCardState,
  ShareTargetType,
  unavailableCard,
} from './share.types';

/**
 * One reader per shareable type: a query that loads rows by id, and the
 * card a row becomes. A row that is not public (any more) becomes the
 * UNAVAILABLE card, the same as a row that is gone.
 *
 * Plain SQL, like `category/category-sql.ts`: the share module imports no
 * session, group, exercise or workout code, so messaging, posts and the
 * website can all use it without import cycles. The "public" rule of each
 * type is restated here, so each one is pinned by a test against the rule
 * its own module uses (`share-targets.spec.ts`).
 */
export interface ShareTarget {
  type: ShareTargetType;
  /** Selects rows with an `id` column; `:ids` is the list asked for. */
  sql: string;
  toCard(row: Record<string, unknown>, now: Date): ShareCard;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  return null;
}

function count(value: unknown): number {
  const n = Number(value);
  if (Number.isFinite(n)) {
    return n;
  }
  return 0;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  if (Number.isFinite(n)) {
    return n;
  }
  return null;
}

/**
 * An occurrence of a series open to anyone (`access = 'OPEN'`) that was not
 * cancelled. Ended once it is over. The place is the venue's name and city:
 * never the street, never the meeting link.
 */
const SESSION: ShareTarget = {
  type: ShareTargetType.Session,
  sql: `
    SELECT si.id,
           COALESCE(si.title_override, st.title) AS name,
           si.start_at AS "startAt",
           si.end_at AS "endAt",
           si.status,
           st.status AS "seriesStatus",
           st.access,
           st.duration_minutes AS "durationMinutes",
           st.timezone,
           st.location_kind AS "locationKind",
           COALESCE(si.capacity_override, st.capacity) AS capacity,
           si.confirmed_count AS "confirmedCount",
           st.price_amount_cents AS "priceCents",
           st.price_currency AS currency,
           v.name AS "placeName",
           v.city AS "placeCity"
    FROM session_instance si
    JOIN session_template st
      ON st.id = si.template_id AND st.deleted_at IS NULL
    LEFT JOIN venue v
      ON v.id = COALESCE(si.venue_id_override, st.venue_id)
     AND v.deleted_at IS NULL
    WHERE si.id IN (:ids) AND si.deleted_at IS NULL`,
  toCard(row, now) {
    const isPublic =
      row.access === 'OPEN' &&
      row.seriesStatus !== 'CANCELLED' &&
      row.status !== 'CANCELLED';
    if (!isPublic) {
      return unavailableCard(ShareTargetType.Session);
    }
    const endAt = new Date(row.endAt as string);
    let state: SessionCard['state'] = ShareCardState.Available;
    if (row.status === 'COMPLETED' || endAt.getTime() <= now.getTime()) {
      state = ShareCardState.Ended;
    }
    let placeName = text(row.placeName);
    let placeCity = text(row.placeCity);
    const online = row.locationKind === 'ONLINE';
    if (online) {
      placeName = null;
      placeCity = null;
    }
    return {
      type: 'SESSION',
      state,
      name: String(row.name ?? ''),
      startAt: new Date(row.startAt as string),
      endAt,
      durationMinutes: numberOrNull(row.durationMinutes),
      timezone: String(row.timezone ?? 'UTC'),
      online,
      placeName,
      placeCity,
      capacity: numberOrNull(row.capacity),
      confirmedCount: count(row.confirmedCount),
      priceCents: numberOrNull(row.priceCents),
      currency: text(row.currency),
    };
  },
};

/** A public, active group. */
const GROUP: ShareTarget = {
  type: ShareTargetType.Group,
  sql: `
    SELECT g.id,
           g.name,
           g.logo_url AS "logoUrl",
           g.city,
           g.join_policy AS "joinPolicy",
           g.is_public AS "isPublic",
           g.is_active AS "isActive",
           (SELECT COUNT(*) FROM group_member gm
             WHERE gm.group_id = g.id AND gm.left_at IS NULL) AS "memberCount"
    FROM "group" g
    WHERE g.id IN (:ids) AND g.deleted_at IS NULL`,
  toCard(row): GroupCard | ShareCard {
    if (row.isPublic !== true || row.isActive !== true) {
      return unavailableCard(ShareTargetType.Group);
    }
    return {
      type: 'GROUP',
      state: ShareCardState.Available,
      name: String(row.name ?? ''),
      logoUrl: text(row.logoUrl),
      city: text(row.city),
      memberCount: count(row.memberCount),
      joinPolicy: String(row.joinPolicy ?? ''),
    };
  },
};

/**
 * A coach in the directory: an active account with a public coach profile.
 * Addressed by the coach's user id. The city only when the coach shows it
 * to everyone (the same per-field rule as their public profile).
 */
const COACH: ShareTarget = {
  type: ShareTargetType.Coach,
  sql: `
    SELECT u.id,
           u.first_name AS "firstName",
           u.last_name AS "lastName",
           u.avatar_url AS "avatarUrl",
           u.handle,
           CASE WHEN COALESCE(u.privacy_settings->>'city', 'PUBLIC') = 'PUBLIC'
                THEN u.city END AS city,
           ip.is_accepting_clients AS "takingClients",
           ip.is_public AS "isPublic",
           COALESCE((SELECT array_agg(cc.category_id ORDER BY cc.created_at)
                       FROM coach_category cc WHERE cc.user_id = u.id),
                    '{}') AS "categoryIds"
    FROM "user" u
    JOIN instructor_profile ip
      ON ip.user_id = u.id AND ip.deleted_at IS NULL
    WHERE u.id IN (:ids) AND u.is_active AND u.deleted_at IS NULL`,
  toCard(row): CoachCard | ShareCard {
    if (row.isPublic !== true) {
      return unavailableCard(ShareTargetType.Coach);
    }
    const firstName = String(row.firstName ?? '');
    const lastName = String(row.lastName ?? '');
    let categoryIds: string[] = [];
    if (Array.isArray(row.categoryIds)) {
      categoryIds = row.categoryIds.map((id) => String(id).trim());
    }
    return {
      type: 'COACH',
      state: ShareCardState.Available,
      name: `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      avatarUrl: text(row.avatarUrl),
      handle: text(row.handle),
      city: text(row.city),
      takingClients: row.takingClients === true,
      categoryIds,
    };
  },
};

/**
 * MotionHive's own exercises and the ones their author made public. The
 * name and the muscles carry their translations, so the reply comes back
 * in the reader's language (ContentLocaleInterceptor).
 */
const EXERCISE: ShareTarget = {
  type: ShareTargetType.Exercise,
  sql: `
    SELECT e.id,
           e.name,
           e.translations,
           e.thumbnail_url AS "thumbnailUrl",
           e.level,
           e.kind,
           e.source,
           e.visibility,
           COALESCE((SELECT json_agg(json_build_object(
                               'commonName', m.common_name,
                               'translations', m.translations)
                             ORDER BY m.display_order)
                       FROM exercise_muscle em
                       JOIN muscle m ON m.id = em.muscle_id
                      WHERE em.exercise_id = e.id AND em.role = 'PRIMARY'),
                    '[]'::json) AS "primaryMuscles"
    FROM exercise e
    WHERE e.id IN (:ids) AND e.deleted_at IS NULL`,
  toCard(row): ExerciseCard | ShareCard {
    if (row.source !== 'SYSTEM' && row.visibility !== 'PUBLIC') {
      return unavailableCard(ShareTargetType.Exercise);
    }
    let primaryMuscles: ExerciseCard['primaryMuscles'] = [];
    if (Array.isArray(row.primaryMuscles)) {
      primaryMuscles = row.primaryMuscles as ExerciseCard['primaryMuscles'];
    }
    return {
      type: 'EXERCISE',
      state: ShareCardState.Available,
      name: String(row.name ?? ''),
      translations: (row.translations as ExerciseCard['translations']) ?? null,
      thumbnailUrl: text(row.thumbnailUrl),
      level: text(row.level),
      kind: text(row.kind),
      primaryMuscles,
    };
  },
};

/**
 * MotionHive's starters: no owner, `source = 'SYSTEM'`, not archived.
 * Programs have no public flag yet; when coaches can publish publicly,
 * that case joins this rule.
 */
const PROGRAM: ShareTarget = {
  type: ShareTargetType.Program,
  sql: `
    SELECT p.id,
           p.name,
           p.translations,
           p.is_single_workout AS "isSingleWorkout",
           p.level,
           p.duration_days AS "durationDays",
           p.cover_image_url AS "coverImageUrl",
           p.source,
           p.owner_id AS "ownerId",
           p.status,
           (SELECT COUNT(*) FROM program_workout pw
             WHERE pw.program_id = p.id) AS "workoutCount"
    FROM program p
    WHERE p.id IN (:ids) AND p.deleted_at IS NULL`,
  toCard(row): ProgramCard | ShareCard {
    const isPublic =
      row.source === 'SYSTEM' && !row.ownerId && row.status !== 'ARCHIVED';
    if (!isPublic) {
      return unavailableCard(ShareTargetType.Program);
    }
    return {
      type: 'PROGRAM',
      state: ShareCardState.Available,
      name: String(row.name ?? ''),
      translations: (row.translations as ProgramCard['translations']) ?? null,
      isSingleWorkout: row.isSingleWorkout === true,
      level: text(row.level),
      durationDays: numberOrNull(row.durationDays),
      workoutCount: count(row.workoutCount),
      coverImageUrl: text(row.coverImageUrl),
    };
  },
};

export const SHARE_TARGETS: Record<ShareTargetType, ShareTarget> = {
  SESSION,
  GROUP,
  COACH,
  EXERCISE,
  PROGRAM,
};
