import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class InvoiceLineItemDto {
  @ApiProperty({ example: 'Single PT Session' })
  @IsString()
  @Length(1, 255)
  description!: string;

  @ApiProperty({ example: 5000 })
  @IsInt()
  @Min(50)
  @Max(99_999_999)
  amountCents!: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;
}

/**
 * Bill-to is one of:
 *   1. clientUserId  → existing BeeActive user
 *   2. guestEmail + guestName → external party
 *
 * The service rejects requests that supply neither or both.
 */
export class CreateInvoiceDto {
  @ApiPropertyOptional({ description: 'Existing BeeActive user id' })
  @ValidateIf((o: CreateInvoiceDto) => !o.guestEmail)
  // @IsUUID()
  clientUserId?: string;

  @ApiPropertyOptional({ example: 'guest@example.com' })
  @ValidateIf((o: CreateInvoiceDto) => !o.clientUserId)
  @IsEmail()
  @MaxLength(255)
  guestEmail?: string;

  @ApiPropertyOptional({ example: 'Ana Popescu' })
  @ValidateIf((o: CreateInvoiceDto) => !!o.guestEmail)
  @IsString()
  @Length(1, 255)
  guestName?: string;

  @ApiProperty({ type: [InvoiceLineItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems!: InvoiceLineItemDto[];

  @ApiPropertyOptional({ example: 'RON', default: 'RON' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: '2026-04-25' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Set true when the service starts immediately on payment (forces ' +
      'EU 14-day cooling-off waiver checkbox at checkout).',
  })
  @IsOptional()
  @IsBoolean()
  requiresImmediateAccessWaiver?: boolean;

  @ApiPropertyOptional({
    description:
      'If true, finalize and send the invoice immediately after creation.',
  })
  @IsOptional()
  @IsBoolean()
  sendImmediately?: boolean;
}
