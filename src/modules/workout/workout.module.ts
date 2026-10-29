import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { InstructorClient } from '../client/entities/instructor-client.entity';
import { ExerciseModule } from '../exercise/exercise.module';
import { RoleModule } from '../role/role.module';
import { SearchModule } from '../search/search.module';
import { User } from '../user/entities/user.entity';
import { AssignedExercise } from './entities/assigned-exercise.entity';
import { AssignedSet } from './entities/assigned-set.entity';
import { AssignedWorkout } from './entities/assigned-workout.entity';
import { ExerciseBlock } from './entities/exercise-block.entity';
import { LoggedExercise } from './entities/logged-exercise.entity';
import { LoggedSet } from './entities/logged-set.entity';
import { OneRepMax } from './entities/one-rep-max.entity';
import { PrescribedExercise } from './entities/prescribed-exercise.entity';
import { PrescribedSet } from './entities/prescribed-set.entity';
import { Program } from './entities/program.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { ProgramWorkout } from './entities/program-workout.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutReport } from './entities/workout-report.entity';
import { Post } from '../post/entities/post.entity';
import { PostComment } from '../post/entities/post-comment.entity';
import { PostReaction } from '../post/entities/post-reaction.entity';
import { WorkoutPhotoService } from './workout-photo.service';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { CoachAccessService } from './coach-access.service';
import { ProgramAssignmentController } from './program-assignment.controller';
import { ProgramAssignmentService } from './program-assignment.service';
import { ProgramController } from './program.controller';
import { ProgramService } from './program.service';
import { InstructorWorkoutLogController } from './instructor-workout-log.controller';
import { WorkoutLogController } from './workout-log.controller';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutReportService } from './workout-report.service';

/**
 * Workout Module — full surface: program authoring (B1.5), client
 * assignment with copy-on-assign tx (B2), and client-side workout
 * logging with %1RM resolution + 1RM history (B3).
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Program,
      ProgramWorkout,
      ExerciseBlock,
      PrescribedExercise,
      PrescribedSet,
      ProgramAssignment,
      AssignedWorkout,
      AssignedExercise,
      AssignedSet,
      WorkoutLog,
      LoggedExercise,
      LoggedSet,
      OneRepMax,
      WorkoutReport,
      // A takedown removes the group posts that were only this workout,
      // with their comments and reactions.
      Post,
      PostComment,
      PostReaction,
      InstructorClient,
      User,
    ]),
    ExerciseModule,
    RoleModule,
    // A takedown takes those posts out of search too.
    SearchModule,
  ],
  controllers: [
    ProgramController,
    ProgramAssignmentController,
    WorkoutLogController,
    InstructorWorkoutLogController,
  ],
  providers: [
    ProgramService,
    ProgramAssignmentService,
    WorkoutLogService,
    WorkoutPhotoService,
    WorkoutReportService,
    CoachAccessService,
    CloudinaryService,
  ],
  exports: [
    ProgramService,
    ProgramAssignmentService,
    WorkoutLogService,
    // Profiles file reports; the admin queue resolves them and reads photos.
    WorkoutReportService,
    WorkoutPhotoService,
    // The coach read rule; ProgressModule scopes its aggregates with it.
    CoachAccessService,
    SequelizeModule,
  ],
})
export class WorkoutModule {}
