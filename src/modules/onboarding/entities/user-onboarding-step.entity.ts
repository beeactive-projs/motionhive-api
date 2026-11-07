import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';
import { OnboardingStep, OnboardingStepStatus } from './onboarding.enums';

/**
 * UserOnboardingStep
 *
 * One row per welcome flow step a person has answered, skipped or closed.
 * No row means the step is still pending. `flowVersion` records which
 * version of the flow the answer belongs to, so a later version can ask a
 * new question without asking the old ones again.
 */
@Table({
  tableName: 'user_onboarding_step',
  timestamps: true,
  underscored: true,
})
export class UserOnboardingStep extends Model {
  @Column({ type: DataType.CHAR(36), primaryKey: true })
  declare userId: string;

  @Column({
    type: DataType.ENUM(...Object.values(OnboardingStep)),
    primaryKey: true,
  })
  declare step: OnboardingStep;

  @Column({
    type: DataType.ENUM(...Object.values(OnboardingStepStatus)),
    allowNull: false,
  })
  declare status: OnboardingStepStatus;

  @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 1 })
  declare flowVersion: number;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
