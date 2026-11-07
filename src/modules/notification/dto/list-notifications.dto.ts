import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { toQueryList } from '../../../common/utils/query.utils';
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
  @Transform(({ value }) => toQueryList(value))
  @IsArray()
  @IsEnum(NotificationCategory, { each: true })
  @IsOptional()
  category?: NotificationCategory[];
}
