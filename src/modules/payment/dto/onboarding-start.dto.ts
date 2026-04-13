import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * OnboardingStartDto
 *
 * Sent by the instructor frontend when the user clicks "Set up payments".
 * Both URLs are optional — when omitted, the service falls back to env-derived
 * defaults (FRONTEND_URL + a fixed path). They exist as overrides for the rare
 * case the FE wants to deep-link back to a non-default screen (e.g. coming
 * from the invoice creation flow rather than the payments dashboard).
 *
 * NOTE: Stripe rejects non-https URLs in live mode and rejects raw localhost
 * URLs entirely. The IsUrl validator allows both during development; the
 * service layer relies on Stripe to enforce the live-mode check.
 */
export class OnboardingStartDto {
  @ApiPropertyOptional({
    description:
      'Where Stripe should redirect after the instructor finishes onboarding.',
    example:
      'https://app.motionhive.fit/instructor/payments/onboarding-complete',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(2048)
  returnUrl?: string;

  @ApiPropertyOptional({
    description:
      'Where Stripe should redirect when the onboarding link expires before completion.',
    example:
      'https://app.motionhive.fit/instructor/payments/onboarding-refresh',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(2048)
  refreshUrl?: string;
}
