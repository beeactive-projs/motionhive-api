import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
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
}
