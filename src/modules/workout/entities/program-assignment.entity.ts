import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
} from 'sequelize-typescript';
import { InstructorClient } from '../../client/entities/instructor-client.entity';
import { User } from '../../user/entities/user.entity';
import { AssignedWorkout } from './assigned-workout.entity';
import { Program } from './program.entity';
import {
  ProgramAssignmentKind,
  ProgramAssignmentStatus,
  ProgramRepeatMode,
} from './workout.enums';

/**
 * ProgramAssignment — a copy-on-assign deep clone of a program for
 * one client. Created in a single transaction by
 * ProgramAssignmentService.assignProgramToClient (locked decision §10).
 *
 * `master_program_id` is informational — the assignment tree (assigned_*
 * tables) is the client's authoritative copy. Editing the master
 * program never propagates here. Per-client overrides (swap exercise,
 * change a target) live on the assigned rows.
 *
 * Status lifecycle:
 *   PENDING → ACTIVE → COMPLETED
 *           ↓
 *           PAUSED (can transition back to ACTIVE)
 *           ↓
 *           CANCELLED (terminal)
 */
@Table({
  tableName: 'program_assignment',
  timestamps: true,
  underscored: true,
  paranoid: true,
})
export class ProgramAssignment extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  /** Null for SELF assignments — nobody is coaching this one. */
  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare instructorId: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(ProgramAssignmentKind)),
    allowNull: false,
    defaultValue: ProgramAssignmentKind.Coach,
  })
  declare assignmentKind: ProgramAssignmentKind;

  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare clientId: string;

  @Column({
    type: DataType.ENUM(...Object.values(ProgramRepeatMode)),
    allowNull: false,
    defaultValue: ProgramRepeatMode.None,
  })
  declare repeatMode: ProgramRepeatMode;

  /** Only set when repeatMode is BLOCK. */
  @Column({ type: DataType.SMALLINT, allowNull: true })
  declare repeatWeeks: number | null;

  /**
   * Client-owned visibility toggle: may the coach see training logged
   * outside this plan. Schema is live; the consent UI ships later.
   */
  /**
   * @deprecated No longer read: superseded by `WorkoutLog.visibility`
   * (migration 073), which carried its few `true` values over. Drop the
   * column after one release.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare shareOffPlan: boolean;

  /** Bound to the active instructor↔client relationship at assign time. */
  @ForeignKey(() => InstructorClient)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare instructorClientId: string | null;

  @ForeignKey(() => Program)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare masterProgramId: string | null;

  /** Frozen at assignment time so deleting the master doesn't blank the row. */
  @Column({ type: DataType.STRING(200), allowNull: false })
  declare programNameSnapshot: string;

  @Column({
    type: DataType.ENUM(...Object.values(ProgramAssignmentStatus)),
    allowNull: false,
    defaultValue: ProgramAssignmentStatus.Active,
  })
  declare status: ProgramAssignmentStatus;

  /** DATE (no time component) — client's local calendar. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  declare startDate: string;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare endDate: string | null;

  /** 0–100, set by the log service as workouts complete. */
  @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 0 })
  declare completionPercent: number;

  /**
   * The coach's note for the client, written when assigning. The client
   * reads it on the plan (web and mobile), so it is not a private note.
   */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  /**
   * When the status last changed (migration 088). While PAUSED it is when
   * the pause began, which resuming reads to move the days left open since.
   * Null when the status never changed since assigning.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  declare statusChangedAt: Date | null;

  /** Who changed it: the coach, or null when the plan finished on its own. */
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare statusChangedBy: string | null;

  /**
   * What the coach told the client with that change, as written (never
   * translated). Replaced on every change, null when they wrote nothing.
   */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare statusMessage: string | null;

  /**
   * When the client was last told about the coach's changes to their copy
   * (migration 089). Done tells them about the days changed after it.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  declare coachChangesNotifiedAt: Date | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
  @DeletedAt declare deletedAt: Date | null;

  @BelongsTo(() => User, 'instructorId')
  declare instructor: User;

  @BelongsTo(() => User, 'clientId')
  declare client: User;

  @BelongsTo(() => Program, 'masterProgramId')
  declare masterProgram: Program | null;

  @HasMany(() => AssignedWorkout)
  declare workouts: AssignedWorkout[];
}
