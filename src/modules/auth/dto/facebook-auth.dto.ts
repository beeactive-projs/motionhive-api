import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  registerDecorator,
  ValidateIf,
} from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SUPPORTED_LOCALES } from '../../../common/i18n';
import type { Locale } from '../../../common/i18n';

/** The catalog sentence for a body that is not one of the two shapes. */
const TOKEN_CHOICE_MESSAGE = 'errors.auth.facebookTokenChoice';

/** The token fields as sent, before any rule ran. */
interface FacebookTokenFields {
  accessToken?: unknown;
  idToken?: unknown;
  rawNonce?: unknown;
}

function isSent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * Exactly one way in: `accessToken` alone (web, Android), or `idToken`
 * with its `rawNonce` (iPhone Limited Login).
 */
export function isOneFacebookToken(body: FacebookTokenFields): boolean {
  const hasAccessToken = isSent(body.accessToken);
  const hasIdToken = isSent(body.idToken);
  const hasRawNonce = isSent(body.rawNonce);
  if (hasAccessToken) {
    return !hasIdToken && !hasRawNonce;
  }
  return hasIdToken && hasRawNonce;
}

/** Checks the whole body with `isOneFacebookToken`, whichever field it sits on. */
function OneFacebookToken() {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'oneFacebookToken',
      target: object.constructor,
      propertyName,
      options: { message: TOKEN_CHOICE_MESSAGE },
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          return isOneFacebookToken(args.object as FacebookTokenFields);
        },
      },
    });
  };
}

/**
 * DTO for Sign in with Facebook, in one of two shapes:
 * - `{ accessToken }`: the Graph access token from Facebook Login (web, Android).
 * - `{ idToken, rawNonce }`: the Limited Login ID token from the iPhone app, and
 *   the raw nonce the app passed to Facebook's login.
 *
 * Anything else answers 400 `auth.facebookTokenChoice`. `accessToken` is
 * checked unless an `idToken` came without it, so a body with neither fails
 * there; `idToken` is checked when sent, so one without its nonce fails there.
 */
export class FacebookAuthDto {
  @ApiPropertyOptional({
    description:
      'Graph access token from Facebook Login (web, Android). Send this or `idToken`, never both.',
    example: 'EAAGm0PX4ZCps8BA...',
  })
  @ValidateIf(
    (dto: FacebookAuthDto) => isSent(dto.accessToken) || !isSent(dto.idToken),
  )
  @IsString({ message: TOKEN_CHOICE_MESSAGE })
  @IsNotEmpty({ message: TOKEN_CHOICE_MESSAGE })
  @MaxLength(4096)
  @OneFacebookToken()
  accessToken?: string;

  @ApiPropertyOptional({
    description:
      'Limited Login ID token (OpenID Connect JWT) from the iPhone app. Requires `rawNonce`.',
    example:
      'eyJhbGciOiJSUzI1NiIsImtpZCI6ImE2ZWE5YTc5MzIwMmNhNzFjZjNiZTJlNzhiNzY5NTZmYTY1NzdlZjcifQ...',
  })
  @IsOptional()
  @IsString({ message: TOKEN_CHOICE_MESSAGE })
  @IsNotEmpty({ message: TOKEN_CHOICE_MESSAGE })
  @MaxLength(8192)
  @OneFacebookToken()
  idToken?: string;

  @ApiPropertyOptional({
    description:
      "The nonce the app passed to Facebook's login, as is (Facebook is given the raw value, not a hash). The ID token's `nonce` claim must equal it. Required with `idToken`, refused with `accessToken`.",
    example: '3f9c0d6e5b1a4c2d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d',
  })
  @IsOptional()
  @IsString({ message: TOKEN_CHOICE_MESSAGE })
  @Length(32, 128)
  rawNonce?: string;

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
