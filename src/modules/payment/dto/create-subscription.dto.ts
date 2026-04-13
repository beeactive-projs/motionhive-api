import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty({ description: 'Client user id (registered BeeActive user)' })
  @IsUUID()
  clientUserId!: string;

  @ApiProperty({ description: 'Product id (must be type SUBSCRIPTION)' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    description: 'Trial period in days. 0 = no trial.',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({
    description: 'Cancel immediately instead of at period end.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  immediate?: boolean;
}
