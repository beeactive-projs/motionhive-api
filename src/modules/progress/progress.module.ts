import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Exercise } from '../exercise/entities/exercise.entity';
import { RoleModule } from '../role/role.module';
import { WorkoutModule } from '../workout/workout.module';
import { CoachClientProgressController } from './coach-client-progress.controller';
import { CoachRosterController } from './coach-roster.controller';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

/**
 * Progress is read-only and derived. It owns no tables — the aggregates
 * run over the workout log and one_rep_max, so nothing here needs a
 * migration or writes anywhere.
 *
 * Imports WorkoutModule for CoachAccessService: a coach's view of a
 * client is scoped by the same rule as the coach's log history.
 */
@Module({
  imports: [SequelizeModule.forFeature([Exercise]), RoleModule, WorkoutModule],
  controllers: [
    ProgressController,
    CoachRosterController,
    CoachClientProgressController,
  ],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
