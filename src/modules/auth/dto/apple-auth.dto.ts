import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SUPPORTED_LOCALES } from '../../../common/i18n';
import type { Locale } from '../../../common/i18n';

/**
 * DTO for Sign in with Apple, from the iPhone app (native sheet) or the web
 * app (Apple's popup). Both send what Apple handed back.
 */
export class AppleAuthDto {
  @ApiProperty({
    description: "Apple's identity token (id_token JWT)",
    example: 'eyJraWQiOiJXNldjT0tCIiwiYWxnIjoiUlMyNTYifQ...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  identityToken: string;

  @ApiProperty({
    description:
      'The raw nonce. Apple was given its SHA-256 (hex), which the identity token must carry.',
    example: '3f9c0d6e5b1a4c2d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d',
  })
  @IsString()
  @Length(32, 128)
  rawNonce: string;

  @ApiPropertyOptional({
    description:
      "Apple's one-time authorization code. Exchanged for the refresh token that revokes the grant when the account is deleted.",
  })
  @IsString()
  @IsOptional()
  @MaxLength(1024)
  authorizationCode?: string;

  @ApiPropertyOptional({
    description:
      'Given name, as the person left it in the Apple sheet. Apple shares it only on the first authorization.',
    example: 'Ana',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({
    description: 'Family name, on the same terms as firstName.',
    example: 'Popescu',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    example: 'ro',
    enum: SUPPORTED_LOCALES,
    description:
      'Language the person is using the app in. Only applied when this sign-in creates the account.',
  })
  @IsIn(SUPPORTED_LOCALES)
  @IsOptional()
  language?: Locale;
}
