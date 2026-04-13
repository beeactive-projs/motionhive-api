import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateCheckoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  successUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  cancelUrl?: string;

  @ApiPropertyOptional({
    description:
      'Client confirms the EU 14-day waiver. REQUIRED when the invoice ' +
      'has requiresImmediateAccessWaiver=true.',
  })
  @IsOptional()
  @IsBoolean()
  immediateAccessWaiverAccepted?: boolean;
}
