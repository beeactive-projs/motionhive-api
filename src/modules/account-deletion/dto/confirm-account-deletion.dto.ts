import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class ConfirmAccountDeletionDto {
  @ApiProperty({
    example: '482913',
    description: 'The 6-digit code emailed by POST /users/me/deletion/code.',
  })
  @Matches(/^\d{6}$/, { message: 'errors.validation.invalidCode' })
  code: string;
}
