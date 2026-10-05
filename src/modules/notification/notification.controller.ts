import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { NotificationDocs } from '../../common/docs/notification.docs';
import { toLocale } from '../../common/i18n';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { NotificationReceiptService } from './services/notification-receipt.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { MarkViewedDto } from './dto/mark-viewed.dto';

/**
 * NotificationController — bell-facing endpoints. Producers don't
 * touch this; the FE does. Every route is JWT-guarded and scoped to
 * `req.user.id` so the service layer enforces ownership.
 */
@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationController {
  constructor(private readonly receipts: NotificationReceiptService) {}

  @Get()
  @ApiEndpoint(NotificationDocs.list)
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListNotificationsDto,
  ) {
    return this.receipts.listForUser(req.user.id, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      unreadOnly: query.unreadOnly,
      categories: query.category,
      locale: toLocale(req.user.language),
    });
  }

  @Get('unread-count')
  @ApiEndpoint(NotificationDocs.unreadCount)
  async unreadCount(@Request() req: AuthenticatedRequest) {
    const count = await this.receipts.unreadCount(req.user.id);
    return { count };
  }

  @Patch('read-all')
  @ApiEndpoint(NotificationDocs.markAllRead)
  markAllRead(@Request() req: AuthenticatedRequest) {
    return this.receipts.markAllAsRead(req.user.id);
  }

  @Patch('viewed')
  @ApiEndpoint(NotificationDocs.markViewed)
  markViewed(@Request() req: AuthenticatedRequest, @Body() dto: MarkViewedDto) {
    return this.receipts.markAsViewed(req.user.id, dto.ids);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint(NotificationDocs.markRead)
  markRead(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.receipts.markAsRead(req.user.id, id);
  }

  @Patch(':id/unread')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint(NotificationDocs.markUnread)
  markUnread(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.receipts.markAsUnread(req.user.id, id);
  }

  @Patch(':id/clicked')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint(NotificationDocs.markClicked)
  markClicked(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.receipts.markAsClicked(req.user.id, id);
  }

  @Patch(':id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint(NotificationDocs.dismiss)
  dismiss(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.receipts.dismiss(req.user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint(NotificationDocs.remove)
  remove(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.receipts.remove(req.user.id, id);
  }
}
