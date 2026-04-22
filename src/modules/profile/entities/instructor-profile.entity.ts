import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';

/**
 * Shape of a single certification entry in the `certifications` JSON
 * column. Instructors can attach any number of these to their profile.
 */
export interface Certification {
  name: string;
  issuingBody?: string;
  issuedAt?: string;
  expiresAt?: string;
  credentialUrl?: string;
}

/**
 * Shape of the `socialLinks` JSON column. All fields optional — the
 * instructor fills in whichever platforms they actually use.
 */
export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  twitter?: string;
  youtube?: string;
  tiktok?: string;
  linkedin?: string;
  website?: string;
}

/**
 * Instructor Profile Entity
 *
 * Professional data for instructors/trainers.
 * This is what clients see when they view an instructor's profile.
 *
 * Created when a user activates "I want to instruct activities".
 * Fields are filled in progressively by the instructor.
 */
@Table({
  tableName: 'instructor_profile',
  timestamps: true,
  underscored: true,
})
export class InstructorProfile extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
    unique: true,
  })
  declare userId: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  declare displayName: string;

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  declare specializations: string[];

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare bio: string;

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  declare certifications: Certification[] | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare yearsOfExperience: number;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: true,
  })
  declare isAcceptingClients: boolean;

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  declare socialLinks: SocialLinks | null;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: true,
  })
  declare showSocialLinks: boolean;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: true,
  })
  declare showEmail: boolean;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
  })
  declare showPhone: boolean;

  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  declare locationCity: string;

  @Column({
    type: DataType.STRING(5),
    allowNull: true,
  })
  declare locationCountry: string;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
  })
  declare isPublic: boolean;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  // Relationships
  @BelongsTo(() => User)
  declare user: User;
}
