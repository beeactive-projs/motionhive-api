import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * `PUT /users/me/onboarding/coach-details`: where a coach works and whether
 * they take new clients. Each field is optional; the ones sent are saved.
 * City and country live on the account, the rest on the coach profile.
 */
export class SetCoachDetailsDto {
  @ApiPropertyOptional({ example: 'Cluj-Napoca' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    example: 'RO',
    description: 'ISO 3166-1 alpha-2 country code (two uppercase letters)',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isAcceptingClients?: boolean;
}
