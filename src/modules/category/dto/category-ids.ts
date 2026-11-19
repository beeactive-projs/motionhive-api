import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

import { toQueryList } from '../../../common/utils/query.utils';

/** More than the list holds, so the cap only stops a runaway client. */
export const MAX_CATEGORIES_PER_PICK = 30;

/**
 * The `categoryIds` filter of a Discover list: rows with any of these
 * categories (ids from `GET /categories`). The param repeats or holds a
 * comma list (`toQueryList`), each id a UUID, at most
 * `MAX_CATEGORIES_PER_PICK`. One definition, so the coach, group and session
 * lists read it alike.
 */
export function CategoryIdsFilter(description: string): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      example: ['0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'],
      isArray: true,
      type: String,
      maxItems: MAX_CATEGORIES_PER_PICK,
      description:
        `${description} (ids from \`GET /categories\`). ` +
        'Repeat the param or separate the ids with commas.',
    }),
    Transform(({ value }) => toQueryList(value)),
    IsArray(),
    ArrayMaxSize(MAX_CATEGORIES_PER_PICK),
    IsUUID('all', { each: true }),
    IsOptional(),
  );
}
