import { Op, WhereOptions } from 'sequelize';

import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutLogStatus, WorkoutVisibility } from './entities/workout.enums';

/**
 * The rule for a workout on someone's profile: theirs, finished, at one
 * of the levels the viewer may see, and not taken down after a report.
 * Every profile read applies it (the list, its count, one workout, its
 * photo and a report on it), so they cannot drift apart. The coach's
 * rule is a different one (`readableLogsWhere`).
 */
export function profileVisibleWhere(
  ownerId: string,
  levels: readonly WorkoutVisibility[],
): WhereOptions<WorkoutLog> {
  return {
    userId: ownerId,
    status: WorkoutLogStatus.Completed,
    visibility: { [Op.in]: [...levels] },
    takenDownAt: null,
  };
}
