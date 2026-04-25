import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { InvoiceLineItemDto } from './create-invoice.dto';

/**
 * Patch a DRAFT invoice in place. The service rejects requests against
 * any invoice that's already past DRAFT (open/paid/void/uncollectible)
 * because Stripe's invoiceItem objects can only be added/removed while
 * the invoice is still a draft.
 *
 * Currency, customer/guest, and fee parameters are not editable here:
 *  - currency is locked once Stripe has accepted the draft;
 *  - changing the bill-to means a different invoice entirely — void this
 *    one and create a new draft instead;
 *  - the platform fee follows account config, recomputed automatically
 *    from the new line-item total.
 *
 * At least one of `lineItems`, `dueDate`, `description` must be present.
 */
export class UpdateInvoiceDto {
  @ApiPropertyOptional({ type: [InvoiceLineItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems?: InvoiceLineItemDto[];

  @ApiPropertyOptional({ example: '2026-04-25' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
