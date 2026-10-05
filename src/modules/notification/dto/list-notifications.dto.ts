import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { NotificationCategory } from '../notification-categories';

/**
 * Query params for GET /notifications.
 *
 * Extends PaginationDto so `page` / `limit` come from one source of
 * truth (1..100, default 20). `unreadOnly` accepts the string forms
 * `'true'` / `'false'` because Express query strings are always
 * strings; class-transformer converts them to booleans before
 * validation runs.
 */
export class ListNotificationsDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'When true, only unread + non-dismissed are returned',
  })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  unreadOnly: boolean = false;

  @ApiPropertyOptional({
    enum: NotificationCategory,
    isArray: true,
    description:
      'Narrow to one or more categories. Repeat the param ' +
      '(`category=SESSIONS&category=PAYMENTS`) or comma-separate ' +
      '(`category=SESSIONS,PAYMENTS`). Omit for everything.',
  })
  @Transform(({ value }) => toCategoryList(value))
  @IsArray()
  @IsEnum(NotificationCategory, { each: true })
  @IsOptional()
  category?: NotificationCategory[];
}

/**
 * Express hands back a string for `?category=A` and an array for
 * `?category=A&category=B`; a comma-separated single value is the
 * third spelling clients reach for. All three become one flat list so
 * the validator and the service see a single shape. Empty input stays
 * undefined so `@IsOptional` skips it. Non-strings pass through
 * untouched, for `@IsEnum` to reject.
 */
function toCategoryList(value: unknown): unknown[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  const list = raw
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');
  return list.length > 0 ? list : undefined;
}
