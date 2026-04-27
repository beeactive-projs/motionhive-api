import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Single filter condition sent by PrimeNG's p-table column filter.
 *
 * Supported matchModes:
 *   Text:    startsWith | endsWith | contains | notContains | equals | notEquals
 *   Number:  equals | notEquals | lt | lte | gt | gte | in | between
 *   Date:    dateIs | dateIsNot | dateBefore | dateAfter
 */
export class FilterMetadataDto {
  @ApiPropertyOptional({
    description:
      'Filter value — string, number, boolean, Date ISO string, or array',
  })
  value: unknown;

  @ApiPropertyOptional({
    example: 'contains',
    enum: [
      'startsWith',
      'endsWith',
      'contains',
      'notContains',
      'equals',
      'notEquals',
      'lt',
      'lte',
      'gt',
      'gte',
      'in',
      'between',
      'dateIs',
      'dateIsNot',
      'dateBefore',
      'dateAfter',
    ],
  })
  matchMode: string;

  @ApiPropertyOptional({
    enum: ['and', 'or'],
    description: 'How multiple conditions on the same column are combined',
  })
  operator?: 'and' | 'or';
}

/**
 * Mirror of PrimeNG's TableLazyLoadEvent — sent as the POST body for
 * any endpoint that uses server-side filtering, sorting, and pagination.
 *
 * Usage in controller:
 *   @Post('filter')
 *   filter(@Body() dto: FilterSettingsDto) { ... }
 *
 * Usage in service:
 *   const opts = buildFilterOptions(dto, { allowedFields: ['name', 'status'] });
 *   const { rows, count } = await this.model.findAndCountAll({ ...opts, include: [...] });
 *   return buildFilterResponse(rows, count, dto);
 */
export class FilterSettingsDto {
  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    description: 'Row offset (PrimeNG `first`)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  first: number = 0;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: 100,
    description: 'Page size (PrimeNG `rows`)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  rows: number = 20;

  @ApiPropertyOptional({
    example: 'createdAt',
    description:
      'Attribute to sort by. Use dot-notation for associations: "instructor.firstName".',
  })
  @IsOptional()
  @IsString()
  sortField?: string | null;

  @ApiPropertyOptional({
    enum: [1, -1],
    default: 1,
    description: '1 = ASC, -1 = DESC',
  })
  @IsOptional()
  @IsInt()
  @IsIn([1, -1])
  sortOrder: number = 1;

  @ApiPropertyOptional({
    description:
      'Column filter map from PrimeNG. Each key is a model attribute name (camelCase). ' +
      'Value is a single FilterMetadata or an array for multi-condition columns.',
  })
  @IsOptional()
  filters?: Record<string, FilterMetadataDto | FilterMetadataDto[]>;

  @ApiPropertyOptional({
    description:
      'Column filter map from PrimeNG. Each key is a model attribute name (camelCase). ' +
      'Value is a single FilterMetadata or an array for multi-condition columns.',
  })
  @IsOptional()
  globalFilter?: string;
}
