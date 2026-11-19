import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsFutureOrCloseToNow } from '../../../common/validators/future-date.validator';
import { RecurrenceRuleDto } from './recurrence-rule.dto';

export class CreateTemplateDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiProperty({ enum: ['GROUP', 'PRIVATE', 'OPEN'] })
  @IsIn(['GROUP', 'PRIVATE', 'OPEN'])
  type: 'GROUP' | 'PRIVATE' | 'OPEN';

  @ApiProperty({ enum: ['OPEN', 'CLIENTS_ONLY', 'GROUP_ONLY', 'FREE'] })
  @IsIn(['OPEN', 'CLIENTS_ONLY', 'GROUP_ONLY', 'FREE'])
  access: 'OPEN' | 'CLIENTS_ONLY' | 'GROUP_ONLY' | 'FREE';

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  approvalRequired?: boolean;

  @ApiPropertyOptional({ description: 'Required when access = GROUP_ONLY' })
  @ValidateIf((o: CreateTemplateDto) => o.access === 'GROUP_ONLY')
  @IsUUID('4')
  groupId?: string;

  @ApiProperty({ enum: ['IN_PERSON', 'ONLINE'] })
  @IsIn(['IN_PERSON', 'ONLINE'])
  locationKind: 'IN_PERSON' | 'ONLINE';

  @ApiPropertyOptional({
    description: 'Required when locationKind = ONLINE. HTTPS only.',
  })
  @ValidateIf((o: CreateTemplateDto) => o.locationKind === 'ONLINE')
  @IsUrl({ require_tld: true, protocols: ['https'] })
  @MaxLength(500)
  meetingUrl?: string;

  @ApiPropertyOptional({
    description: 'Required when locationKind = IN_PERSON',
  })
  @ValidateIf((o: CreateTemplateDto) => o.locationKind === 'IN_PERSON')
  @IsOptional()
  @IsUUID('4')
  venueId?: string;

  @ApiProperty({ minimum: 5, maximum: 480 })
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes: number;

  @ApiProperty({ description: 'IANA timezone', example: 'Europe/Bucharest' })
  @IsString()
  @IsNotEmpty()
  timezone: string;

  @ApiPropertyOptional({
    description: '1..1000; null = uncapped',
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  waitlistEnabled?: boolean;

  @ApiPropertyOptional({
    description: '0..168 hours; default 24',
    minimum: 0,
    maximum: 168,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  cancellationCutoffHours?: number;

  @ApiPropertyOptional({
    description: 'Display-only; ≥ 0 cents; default 0',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  // 999,999.99 in any currency: shown on Discover, so bounded.
  @Max(99_999_999)
  priceAmountCents?: number;

  @ApiPropertyOptional({
    description: '3-letter ISO 4217; default RON',
    maxLength: 3,
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  priceCurrency?: string;

  @ApiProperty()
  @IsBoolean()
  isRecurring: boolean;

  @ApiPropertyOptional({ description: 'Required when isRecurring = true' })
  @ValidateIf((o: CreateTemplateDto) => o.isRecurring === true)
  @ValidateNested()
  @Type(() => RecurrenceRuleDto)
  recurrenceRule?: RecurrenceRuleDto;

  @ApiProperty({
    description:
      'ISO 8601 datetime of the first occurrence. Must be in the future (5-minute past tolerance for client clock skew).',
  })
  @IsISO8601()
  @IsFutureOrCloseToNow({ skewMinutes: 5 })
  firstStartAt: string;

  @ApiPropertyOptional({
    description:
      'Auto-create 1 instance (non-recurring) or N instances (recurring). Default true for non-recurring, false for recurring.',
  })
  @IsOptional()
  @IsBoolean()
  generateInitialInstances?: boolean;

  @ApiPropertyOptional({
    description:
      'For recurring: how many initial instances to generate (1..104); default 12',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(104)
  initialInstancesCount?: number;
}
