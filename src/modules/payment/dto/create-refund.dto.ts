import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRefundDto {
  @ApiProperty({ description: 'Payment id to refund' })
  @IsUUID()
  paymentId!: string;

  @ApiPropertyOptional({
    description: 'Amount in cents to refund. Omit for full refund.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99_999_999)
  amountCents?: number;

  @ApiPropertyOptional({
    description: 'Reason for the refund (shown to client)',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
