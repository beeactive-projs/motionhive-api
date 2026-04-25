import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
} from 'sequelize-typescript';
import { InstructorProfile } from '../../profile/entities/instructor-profile.entity';

/**
 * Kind of place where an instructor delivers their service.
 *
 * Keep in sync with `venue_kind` Postgres enum (migration 027).
 */
export enum VenueKind {
  GYM = 'GYM',
  STUDIO = 'STUDIO',
  PARK = 'PARK',
  OUTDOOR = 'OUTDOOR',
  CLIENT_HOME = 'CLIENT_HOME',
  ONLINE = 'ONLINE',
  OTHER = 'OTHER',
}

/**
 * Video meeting provider for online venues. Only the instructor's
 * preferred platform is stored; per-session meeting links live on
 * the session row.
 *
 * Keep in sync with `meeting_provider` Postgres enum (migration 027).
 */
export enum MeetingProvider {
  ZOOM = 'ZOOM',
  GOOGLE_MEET = 'GOOGLE_MEET',
  TEAMS = 'TEAMS',
  OTHER = 'OTHER',
}

/**
 * Venue Entity
 *
 * Where an instructor delivers their service. One instructor has
 * 0..N venues; a `session` references exactly one via `venueId`.
 *
 * Shapes the venue covers:
 *   - Physical (GYM / STUDIO / PARK / OUTDOOR / OTHER): address fields required, `isOnline=false`.
 *   - Online (ONLINE): `meetingUrl` + optional `meetingProvider`, `isOnline=true`, address fields null.
 *   - Mobile (CLIENT_HOME): no address (client's address belongs to the booking), `travelRadiusKm` optional.
 *
 * Lifecycle:
 *   - `isActive=false`: instructor archived the venue; hide from new-session pickers but keep FK valid.
 *   - `deletedAt`: paranoid soft-delete; sessions that referenced it keep `venueId` via migration 027.
 */
@Table({
  tableName: 'venue',
  timestamps: true,
  underscored: true,
  paranoid: true,
})
export class Venue extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => InstructorProfile)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare instructorId: string;

  @Column({
    type: DataType.ENUM(...Object.values(VenueKind)),
    allowNull: false,
  })
  declare kind: VenueKind;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isOnline: boolean;

  @Column({
    type: DataType.STRING(160),
    allowNull: false,
  })
  declare name: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare notes: string | null;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare line1: string | null;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare line2: string | null;

  @Column({
    type: DataType.STRING(120),
    allowNull: true,
  })
  declare city: string | null;

  @Column({
    type: DataType.STRING(120),
    allowNull: true,
  })
  declare region: string | null;

  @Column({
    type: DataType.STRING(20),
    allowNull: true,
  })
  declare postalCode: string | null;

  /** ISO 3166-1 alpha-2, e.g. 'RO'. DB CHECK enforces `^[A-Z]{2}$`. */
  @Column({
    type: DataType.CHAR(2),
    allowNull: true,
  })
  declare countryCode: string | null;

  /**
   * Latitude / longitude are DECIMAL(9,6) in Postgres; Sequelize's
   * default pg mapping returns them as strings. The getter coerces
   * to number on read so the TS type (`number | null`) is honest.
   */
  @Column({
    type: DataType.DECIMAL(9, 6),
    allowNull: true,
    get(this: Venue): number | null {
      const raw = this.getDataValue('latitude');
      return raw == null ? null : Number(raw);
    },
  })
  declare latitude: number | null;

  @Column({
    type: DataType.DECIMAL(9, 6),
    allowNull: true,
    get(this: Venue): number | null {
      const raw = this.getDataValue('longitude');
      return raw == null ? null : Number(raw);
    },
  })
  declare longitude: number | null;

  /**
   * Persistent meeting URL for online venues. Required when
   * `isOnline=true` (DB-level CHECK). Per-session overrides live on
   * the session row.
   */
  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare meetingUrl: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(MeetingProvider)),
    allowNull: true,
  })
  declare meetingProvider: MeetingProvider | null;

  /**
   * For mobile trainers (kind=CLIENT_HOME): how far the instructor is
   * willing to travel, in kilometres. Null = no declared limit.
   */
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare travelRadiusKm: number | null;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  })
  declare isActive: boolean;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare displayOrder: number | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date | null;

  @BelongsTo(() => InstructorProfile)
  declare instructor: InstructorProfile;
}
