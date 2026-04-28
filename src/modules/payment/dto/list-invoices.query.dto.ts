import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { InvoiceStatus } from '../entities/invoice.entity';

export class ListInvoicesQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: InvoiceStatus,
    description: 'Filter by invoice status',
  })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  /**
   * Filter to invoices for one specific client. Server-side validation
   * still scopes to the calling instructor — passing another
   * instructor's client id silently returns empty.
   */
  @ApiPropertyOptional({
    description: 'Filter to a single client (instructor view only)',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /**
   * Inclusive lower bound on invoice.createdAt (ISO 8601).
   */
  @ApiPropertyOptional({
    description: 'Earliest createdAt to include (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  /**
   * Inclusive upper bound on invoice.createdAt (ISO 8601).
   */
  @ApiPropertyOptional({
    description: 'Latest createdAt to include (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}
