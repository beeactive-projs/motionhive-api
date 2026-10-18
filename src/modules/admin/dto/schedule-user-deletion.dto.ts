import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * Acting on an emailed deletion request. `requestEmail` is the address the
 * request came from; it must be the account's sign-in email, which is how
 * the policy says we confirm the request is really theirs.
 */
export class ScheduleUserDeletionDto {
  @ApiProperty({
    description: 'The address the deletion request was sent from.',
    example: 'ana@example.com',
  })
  @IsEmail({}, { message: 'errors.validation.invalidEmail' })
  @MaxLength(255)
  requestEmail!: string;
}
