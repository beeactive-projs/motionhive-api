import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { EXERCISE_NOTE_MAX_LENGTH } from '../entities/exercise-note.entity';

/**
 * `PUT /exercises/:id/note`. The note is trimmed; empty, blank or null
 * deletes it.
 */
export class UpdateExerciseNoteDto {
  @ApiPropertyOptional({
    example: 'Seat on 4, elbows in.',
    maxLength: EXERCISE_NOTE_MAX_LENGTH,
    nullable: true,
    description: 'Empty, blank or null deletes the note.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(EXERCISE_NOTE_MAX_LENGTH, {
    message: 'errors.validation.exerciseNoteTooLong',
  })
  note?: string | null;
}
