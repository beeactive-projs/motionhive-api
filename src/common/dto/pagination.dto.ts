import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNumber, Min, Max } from 'class-validator';

/**
 * Pagination Query DTO
 *
 * Reusable query parameters for paginated list endpoints.
 * Use @Query() pagination: PaginationDto in controllers.
 *
 * Defaults:
 * - page: 1
 * - limit: 20
 * - Max limit: 100 (prevents absurdly large queries)
 */
export class PaginationDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Page number (1-indexed)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Items per page (max 100)',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * Paginated response wrapper
 *
 * Matches PrimeNG p-table / p-paginator expected format:
 * - items: the data array
 * - total: total number of records
 * - page: current page (1-indexed)
 * - pageSize: items per page
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Helper to calculate offset from page/limit
 */
export function getOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Helper to build paginated response (PrimeNG-compatible)
 */
export function buildPaginatedResponse<T>(
  data: T[],
  totalItems: number,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  return {
    items: data,
    total: totalItems,
    page,
    pageSize: limit,
  };
}
