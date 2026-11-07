import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { WorkoutVisibility } from '../entities/workout.enums';

/** Body for `PATCH /workout-logs/:id/visibility`. */
export class SetWorkoutVisibilityDto {
  @ApiProperty({
    enum: Object.values(WorkoutVisibility),
    example: WorkoutVisibility.CoachesOnly,
    description:
      'Who besides the owner sees it. The coach whose plan it came from always does.',
  })
  @IsIn(Object.values(WorkoutVisibility))
  visibility!: WorkoutVisibility;
}
