import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ModerationDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class ModeratePostDto {
  @ApiProperty({ enum: ModerationDecision })
  @IsEnum(ModerationDecision)
  decision: ModerationDecision;
}
