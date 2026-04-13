import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { ProductInterval, ProductType } from '../entities/product.entity';

export class CreateProductDto {
  @ApiProperty({ example: 'Single PT Session', maxLength: 255 })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: ProductType })
  @IsEnum(ProductType)
  type!: ProductType;

  @ApiProperty({
    example: 5000,
    description: 'Price in the smallest currency unit (cents/bani)',
  })
  @IsInt()
  @Min(50)
  @Max(99_999_999)
  amountCents!: number;

  @ApiPropertyOptional({ example: 'RON', default: 'RON' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  // Subscription-only fields. Validated only when type=SUBSCRIPTION.
  @ApiPropertyOptional({ enum: ProductInterval })
  @ValidateIf((o: CreateProductDto) => o.type === ProductType.SUBSCRIPTION)
  @IsEnum(ProductInterval)
  interval?: ProductInterval;

  @ApiPropertyOptional({ example: 1 })
  @ValidateIf((o: CreateProductDto) => o.type === ProductType.SUBSCRIPTION)
  @IsInt()
  @Min(1)
  @Max(12)
  intervalCount?: number;
}
