import type {
  PrivacyControlledField,
  ProfilePrivacyLevel,
  UserPrivacySettings,
} from '../user/entities/user.entity';

/**
 * Audience tier resolved server-side per request. Order matters: when
 * a viewer is both the owner and (logically) a coach of themselves, we
 * pick the higher-privilege tier first.
 */
export type PublicProfileAudience = 'OWNER' | 'COACH' | 'PUBLIC';

/**
 * Per-field default visibility, applied when `user.privacy_settings`
 * has no entry for the field. Kept in one table so the FE helper
 * (`resolveFieldPrivacy` in core) and the server stay aligned.
 */
const PRIVACY_DEFAULTS: Record<PrivacyControlledField, ProfilePrivacyLevel> = {
  firstName: 'PUBLIC',
  lastName: 'PUBLIC',
  avatarUrl: 'PUBLIC',
  email: 'ONLY_ME',
  phone: 'ONLY_ME',
  city: 'PUBLIC',
  language: 'COACHES_ONLY',
  timezone: 'COACHES_ONLY',
};

/**
 * Pure helper — returns true iff the field is visible to the given
 * audience tier. Exported for unit testing the matrix in isolation.
 */
export function isFieldVisible(
  level: ProfilePrivacyLevel,
  audience: PublicProfileAudience,
): boolean {
  if (audience === 'OWNER') return true;
  if (audience === 'COACH') return level !== 'ONLY_ME';
  return level === 'PUBLIC';
}

export function resolveLevel(
  settings: UserPrivacySettings | null | undefined,
  field: PrivacyControlledField,
): ProfilePrivacyLevel {
  return settings?.[field] ?? PRIVACY_DEFAULTS[field];
}
