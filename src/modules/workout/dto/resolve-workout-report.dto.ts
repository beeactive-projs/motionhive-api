import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationDto } from '../../../common/dto/pagination.dto';
import { MessageReportStatus } from '../../messaging/entities/message-report.entity';

/** Admin filter for the workout report queue; open reports come first. */
export class ListWorkoutReportsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: MessageReportStatus })
  @IsOptional()
  @IsEnum(MessageReportStatus)
  status?: MessageReportStatus;
}

/**
 * Move a workout report on. OPEN goes to REVIEWING, RESOLVED or DISMISSED;
 * REVIEWING to RESOLVED or DISMISSED; a closed report stays closed.
 * `takeDown` only goes with RESOLVED.
 */
export class ResolveWorkoutReportDto {
  @ApiProperty({ enum: MessageReportStatus })
  @IsEnum(MessageReportStatus)
  status!: MessageReportStatus;

  @ApiPropertyOptional({
    description:
      'Take the workout down: off the profile and group cards, Only me, and never Public again. The owner is told why.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  takeDown?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNotes?: string;
}
