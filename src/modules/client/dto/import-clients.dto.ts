import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SUPPORTED_LOCALES } from '../../../common/i18n';
import type { Locale } from '../../../common/i18n';

/**
 * Most rows one import takes. Keeps preview and commit synchronous (a few
 * batched queries and one transaction), and bounds how much email one
 * request can put on our sending domain. The validation message
 * `errors.validation.importTooManyRows` spells the number out: change both.
 */
export const CLIENT_IMPORT_MAX_ROWS = 200;

/**
 * One person from the coach's spreadsheet.
 *
 * `email` is a plain string on purpose, not `@IsEmail`: a bad address is
 * a row the review screen shows as "fix this", not a 400 for the whole
 * list. The service checks the format per row.
 */
export class ImportClientRowDto {
  @ApiProperty({ example: 'ana.pop@example.com' })
  @IsString()
  @MaxLength(320)
  email: string;

  @ApiPropertyOptional({ example: 'Ana' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Pop' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    example: 'Knee injury in 2025. Wants to run a 10k.',
    description:
      "Coach's private note. Copied into the client's notes when they accept; never shown to them.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/**
 * Body of `POST /clients/import/preview` and `POST /clients/import`.
 *
 * Both routes take the same body and run the same checks, so the list
 * the coach reviewed is exactly the list that gets sent. Preview ignores
 * `message`, `locale` and `resendPending`.
 */
export class ImportClientsDto {
  @ApiProperty({ type: [ImportClientRowDto], maxItems: CLIENT_IMPORT_MAX_ROWS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CLIENT_IMPORT_MAX_ROWS, {
    message: 'errors.validation.importTooManyRows',
  })
  @ValidateNested({ each: true })
  @Type(() => ImportClientRowDto)
  rows: ImportClientRowDto[];

  @ApiPropertyOptional({
    example: 'I moved our training to MotionHive. Join me here!',
    description: 'One personal message, shown in every invite email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiPropertyOptional({
    enum: SUPPORTED_LOCALES,
    example: 'ro',
    description:
      "Language of the email for people with no account yet. Defaults to the coach's. People with an account get theirs.",
  })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: Locale;

  @ApiPropertyOptional({
    example: false,
    description:
      'Also send again to people this coach already invited. Renews their invitation for 30 days.',
  })
  @IsOptional()
  @IsBoolean()
  resendPending?: boolean;
}

/**
 * Body of `POST /clients/import/email-preview`: what the coach has typed so
 * far, so the preview shows their own message in the language they picked.
 */
export class PreviewImportEmailDto {
  @ApiPropertyOptional({ example: 'I moved our training to MotionHive.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_LOCALES, example: 'ro' })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: Locale;

  @ApiPropertyOptional({
    example: 'Ana',
    description:
      'Who the sample is addressed to: the first person on the list.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  recipientFirstName?: string;
}
