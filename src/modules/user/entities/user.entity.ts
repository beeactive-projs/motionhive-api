import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
  BelongsToMany,
  HasMany,
} from 'sequelize-typescript';
import { Role } from '../../role/entities/role.entity';
import { UserRole } from '../../role/entities/user-role.entity';
import { SocialAccount } from './social-account.entity';
import type { StoredWorkoutSettings } from '../workout-settings';
import { ExerciseLevel } from '../../exercise/entities/exercise.enums';

/**
 * Visibility level a user can pick for an individual profile field.
 * - PUBLIC       — anyone (including anonymous viewers) can see it.
 * - COACHES_ONLY — only active coaches of this user can see it.
 * - ONLY_ME      — only the owner sees it.
 */
export type ProfilePrivacyLevel = 'PUBLIC' | 'COACHES_ONLY' | 'ONLY_ME';

/**
 * Who may start a chat with this person (migration 090, "Who can message
 * you").
 * - EVERYONE    — anyone's first message lands straight in their chats.
 * - REQUESTS    — people they are connected with go straight in; anyone
 *                 else's first message arrives as a message request.
 * - CONNECTIONS — only people they are connected with can start a chat.
 */
export const MessagePolicy = {
  Everyone: 'EVERYONE',
  Requests: 'REQUESTS',
  Connections: 'CONNECTIONS',
} as const;
export type MessagePolicy = (typeof MessagePolicy)[keyof typeof MessagePolicy];

/**
 * Fields whose visibility the user can control. Keys are optional —
 * missing keys fall back to per-field defaults applied at the service
 * layer (`resolveFieldPrivacy`), so a freshly-created account with
 * `privacy_settings = '{}'` still behaves correctly.
 */
export type PrivacyControlledField =
  | 'firstName'
  | 'lastName'
  | 'avatarUrl'
  | 'email'
  | 'phone'
  | 'city'
  | 'language'
  | 'timezone'
  /** Not a profile field: the level new workouts start at (migration 073). */
  | 'workouts';

export type UserPrivacySettings = Partial<
  Record<PrivacyControlledField, ProfilePrivacyLevel>
>;

@Table({
  tableName: 'user',
  paranoid: true,
  timestamps: true,
  underscored: true,
})
export class User extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING(255),
    unique: true,
    allowNull: false,
  })
  declare email: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare passwordHash: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare firstName: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare lastName: string;

  @Column({
    type: DataType.STRING(20),
    allowNull: true,
  })
  declare phone: string;

  @Column({
    type: DataType.SMALLINT,
    defaultValue: 1,
  })
  declare avatarId: number;

  /**
   * Public URL of the user's uploaded profile picture.
   * Null until they upload one; UI falls back to a coloured initials
   * badge in that case.
   */
  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare avatarUrl: string | null;

  /**
   * Storage key of the uploaded avatar. Used to DELETE the previous
   * file when the user replaces their picture — without this
   * we'd leak storage on every re-upload.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare avatarPublicId: string | null;

  @Column({
    type: DataType.STRING(5),
    defaultValue: 'en',
  })
  declare language: string;

  @Column({
    type: DataType.STRING(50),
    defaultValue: 'Europe/Bucharest',
  })
  declare timezone: string;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: true,
  })
  declare isActive: boolean;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
  })
  declare isEmailVerified: boolean;

  // SHA-256 hash of the verification token; never stores plaintext.
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare emailVerificationToken: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare emailVerificationExpires: Date | null;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare passwordResetToken: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare passwordResetExpires: Date | null;

  @Column({
    type: DataType.INTEGER,
    defaultValue: 0,
  })
  declare failedLoginAttempts: number;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare lockedUntil: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare passwordChangedAt: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare lastLoginAt: Date;

  /**
   * ISO 3166-1 alpha-2 country code (uppercase, e.g. 'RO').
   *
   * Source of truth for the user's country — feeds Stripe Connect
   * onboarding (instructors) and display. Nullable so signup doesn't
   * force it; service-layer validation enforces presence before
   * Stripe onboarding.
   */
  @Column({
    type: DataType.CHAR(2),
    allowNull: true,
  })
  declare countryCode: string | null;

  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  declare city: string | null;

  /**
   * Short, case-insensitive URL slug used by `/@<handle>` profiles.
   * Nullable so signup doesn't have to pick one up-front; the migration
   * backfills existing rows and a small app-side script
   * (`scripts/backfill-user-handles.js`) covers anything the SQL
   * backfill couldn't resolve.
   */
  @Column({
    type: DataType.STRING(40),
    allowNull: true,
  })
  declare handle: string | null;

  /**
   * Per-field visibility map. See `UserPrivacySettings`. Defaults to
   * `{}` and is patched in place via `PATCH /profile/privacy`; missing
   * keys resolve to per-field defaults at read time.
   */
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: {},
  })
  declare privacySettings: UserPrivacySettings;

  /**
   * "Who can message you" (migration 090). Read and changed through
   * `/messaging/settings`.
   */
  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: MessagePolicy.Requests,
  })
  declare messagePolicy: MessagePolicy;

  /**
   * "Let people find me by name" (migration 091). While off, people search
   * matches this person only by their whole email address. On by default.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  })
  declare findByName: boolean;

  /**
   * The workout logger settings the person changed (migration 079). See
   * `WorkoutSettings`: missing keys resolve to defaults at read time
   * (`resolveWorkoutSettings`). Read and patched through
   * `/users/me/workout-settings`.
   */
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: {},
  })
  declare workoutSettings: StoredWorkoutSettings;

  /**
   * How the person rates their own training (migration 081), asked in the
   * welcome flow. Same scale as `exercise.level` and `program.level`, so
   * suggestions can match on it. Null until answered.
   */
  @Column({
    type: DataType.ENUM(...Object.values(ExerciseLevel)),
    allowNull: true,
  })
  declare fitnessLevel: ExerciseLevel | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date;

  // Relationships
  @BelongsToMany(() => Role, () => UserRole)
  declare roles: Role[];

  @HasMany(() => SocialAccount)
  declare socialAccounts: SocialAccount[];
}

/**
 * What another person may see of someone on a card: a comment, a post,
 * a blocked-people row. No email, phone, city or language: those follow
 * the person's privacy settings and never ride along on a card.
 * (`USER_SAFE_ATTRIBUTES` is safe only in the sense of no secrets; it is
 * for the person's own reads.)
 */
export const USER_CARD_ATTRIBUTES: Array<keyof User> = [
  'id',
  'firstName',
  'lastName',
  'avatarUrl',
  'handle',
];

/**
 * Safe primitive User fields for use in Sequelize `attributes` arrays.
 * Excludes secrets (passwordHash, tokens, lockout fields) and JSONB columns.
 * Import this instead of hand-rolling field lists in includes/queries.
 */
export const USER_SAFE_ATTRIBUTES: Array<keyof User> = [
  'id',
  'email',
  'firstName',
  'lastName',
  'handle',
  'phone',
  'avatarId',
  'avatarUrl',
  'language',
  'timezone',
  'countryCode',
  'city',
  'isActive',
  'isEmailVerified',
  'createdAt',
  'updatedAt',
];
