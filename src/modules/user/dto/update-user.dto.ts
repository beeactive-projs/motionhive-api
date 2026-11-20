import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsNumber,
  Length,
  Matches,
  MaxLength,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SUPPORTED_LOCALES } from '../../../common/i18n';
import type { Locale } from '../../../common/i18n';

/**
 * Update User DTO
 *
 * For updating core user fields (name, phone, avatar, language, timezone,
 * country, city). Email change is NOT supported here — requires separate
 * re-verification flow.
 *
 * `countryCode` is ISO 3166-1 alpha-2 (two uppercase letters). The
 * strict Stripe-Connect-supported-country check runs in the payment
 * service right before onboarding, so users in unsupported countries
 * can still save a profile.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'John' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  lastName?: string;

  /**
   * E.164 phone number — `+` + country calling code + national number,
   * digits only, max 15 digits. `null` clears the stored number.
   * Validation uses the ITU E.164 regex; callers submitting anything
   * else get a 400 with a clear message.
   */
  @ApiPropertyOptional({
    example: '+40712345678',
    description: 'E.164 phone number (e.g. +40712345678), or null to clear.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'errors.validation.invalidPhone',
  })
  phone?: string | null;

  @ApiPropertyOptional({ example: 1, description: 'Avatar ID (1-20)' })
  @IsNumber()
  @Min(1)
  @Max(20)
  @IsOptional()
  avatarId?: number;

  @ApiPropertyOptional({
    example: 'en',
    enum: SUPPORTED_LOCALES,
    description:
      'UI language. Also the language of notifications and emails we send.',
  })
  @IsIn(SUPPORTED_LOCALES)
  @IsOptional()
  language?: Locale;

  @ApiPropertyOptional({ example: 'Europe/Bucharest' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({
    example: 'RO',
    description: 'ISO 3166-1 alpha-2 country code (two uppercase letters)',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be 2 uppercase letters (ISO 3166-1 alpha-2)',
  })
  countryCode?: string;

  @ApiPropertyOptional({ example: 'Cluj-Napoca' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    description:
      'Let people find you by name or handle in people search. Off, only your whole email address finds you.',
  })
  @IsOptional()
  @IsBoolean()
  findByName?: boolean;
}
