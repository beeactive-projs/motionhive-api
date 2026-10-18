import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RestoreAccountDto {
  @ApiProperty({
    description:
      'The `restoreTicket` a sign-in returned with ACCOUNT_SCHEDULED_FOR_DELETION. Valid for 15 minutes.',
  })
  @IsString()
  @MaxLength(2000)
  ticket: string;
}
