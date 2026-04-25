import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MeetingProvider, VenueKind } from '../entities/venue.entity';

/**
 * Create Venue DTO
 *
 * One DTO covers physical, online, and mobile (CLIENT_HOME) venues;
 * cross-field consistency rules are enforced in VenueService
 * (e.g. ONLINE requires `meetingUrl`). DTO-level validation only
 * checks per-field shape and bounds — anything that depends on two
 * fields belongs in the service.
 *
 * `@IsUrl` on `meetingUrl` restricts protocols to http/https to
 * prevent `javascript:` or `data:` URLs from reaching the frontend.
 */
export class CreateVenueDto {
  @ApiProperty({ enum: VenueKind, example: VenueKind.GYM })
  @IsEnum(VenueKind)
  kind: VenueKind;

  @ApiPropertyOptional({
    description:
      'True when the venue is an online meeting. When true, `meetingUrl` must be provided.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiProperty({ example: 'FitZone Cluj — Downtown', maxLength: 160 })
  @IsString()
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional({ example: 'Meet at the main entrance.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ example: 'Str. Memorandumului 28', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  line1?: string;

  @ApiPropertyOptional({ example: 'Et. 2, Studio A', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  line2?: string;

  @ApiPropertyOptional({ example: 'Cluj-Napoca', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'Cluj', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @ApiPropertyOptional({ example: '400114', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9\s\-]{2,20}$/, {
    message:
      'postalCode must be 2–20 alphanumerics (spaces and dashes allowed)',
  })
  postalCode?: string;

  @ApiPropertyOptional({
    example: 'RO',
    description: 'ISO 3166-1 alpha-2 country code (uppercase)',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be 2 uppercase letters' })
  countryCode?: string;

  @ApiPropertyOptional({ example: 46.7712 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 23.6236 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({
    example: 'https://us06web.zoom.us/j/0000000000',
    description:
      'Persistent meeting URL. Required when `isOnline=true` (or when kind=ONLINE).',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  meetingUrl?: string;

  @ApiPropertyOptional({ enum: MeetingProvider, example: MeetingProvider.ZOOM })
  @IsOptional()
  @IsEnum(MeetingProvider)
  meetingProvider?: MeetingProvider;

  @ApiPropertyOptional({
    example: 15,
    description:
      'Mobile trainer travel radius in kilometres. Only meaningful when kind=CLIENT_HOME.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  travelRadiusKm?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  displayOrder?: number;
}
