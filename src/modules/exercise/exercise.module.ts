import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CloudinaryService } from '../../common/services/cloudinary.service';
import { RoleModule } from '../role/role.module';
import { SearchModule } from '../search/search.module';
import { User } from '../user/entities/user.entity';
import { Exercise } from './entities/exercise.entity';
import { Muscle } from './entities/muscle.entity';
import { Equipment } from './entities/equipment.entity';
import { ExerciseMuscle } from './entities/exercise-muscle.entity';
import { ExerciseEquipment } from './entities/exercise-equipment.entity';
import { ExerciseMedia } from './entities/exercise-media.entity';
import { ExerciseNote } from './entities/exercise-note.entity';
import { ExerciseService } from './exercise.service';
import { ExerciseNoteService } from './exercise-note.service';
import { ExerciseSearchService } from './exercise-search.service';
import { ExercisePopularityService } from './exercise-popularity.service';
import { ExerciseController } from './exercise.controller';
import { MuscleController } from './muscle.controller';
import { EquipmentController } from './equipment.controller';

/**
 * Exercise Module
 *
 * Owns the exercise catalog (system + instructor-created), the muscle
 * and equipment taxonomy, and the per-exercise media overlay.
 *
 * Public surface:
 *   - /exercises               — instructor + client (gated by §19)
 *   - /muscles, /equipment     — taxonomy reads, any auth
 *
 * Depends on:
 *   - SearchModule         — `SearchIndexService.upsertExercise` after
 *                            create/update; `removeIfExists` on soft delete.
 *   - NotificationModule   — `@Global()`; injected for `EXERCISE_FORKED`
 *                            (defined in `notification-types.ts`).
 *
 * Other modules (program / workout / log) will `BelongsTo` Exercise via
 * the Sequelize registry once they're scaffolded. No forwardRef needed
 * because Exercise has no inbound dependency on those modules.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Exercise,
      Muscle,
      Equipment,
      ExerciseMuscle,
      ExerciseEquipment,
      ExerciseMedia,
      // A person's private note per exercise (migration 079).
      ExerciseNote,
      // `User` is registered here as a model provider only so the
      // browse-gate (`canClientBrowseCatalog`) can read `exerciseCatalogOptIn`
      // without forcing a UserModule import (which would create a cycle).
      User,
    ]),
    // RolesGuard depends on RoleService; mirror the venue/session pattern.
    RoleModule,
    SearchModule,
  ],
  controllers: [ExerciseController, MuscleController, EquipmentController],
  providers: [
    ExerciseService,
    ExerciseNoteService,
    // Search: the query plan's taxonomy and the searcher's own history.
    ExerciseSearchService,
    // `exercise.popularity_score`, for search ranking.
    ExercisePopularityService,
    // Exercise pictures (ExerciseService.setImage).
    CloudinaryService,
  ],
  // ExerciseNoteService: the owner's workout reads carry their notes.
  // ExercisePopularityService: the nightly recompute job.
  exports: [
    ExerciseService,
    ExerciseNoteService,
    ExercisePopularityService,
    SequelizeModule,
  ],
})
export class ExerciseModule {}
