import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RescheduleSessionDto {
  @ApiProperty({
    example: '2026-03-20T09:00:00.000Z',
    description: 'New scheduled date/time for the session',
  })
  @IsDateString()
  @IsNotEmpty()
  scheduledAt: string;

  @ApiProperty({
    example: 'Instructor schedule conflict',
    description: 'Optional reason for rescheduling',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
