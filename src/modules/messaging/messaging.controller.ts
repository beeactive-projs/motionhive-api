import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { MessagingDocs } from '../../common/docs/messaging.docs';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { BlockUserDto } from './dto/block-user.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { MuteConversationDto } from './dto/mute-conversation.dto';
import { ReportMessageDto } from './dto/report-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagingModerationService } from './messaging-moderation.service';
import { MessagingSafetyService } from './messaging-safety.service';
import { MessagingService } from './messaging.service';

/**
 * Messaging Controller (user-facing).
 *
 * Stage 2 endpoints:
 *   POST   /messaging/messages                     send a DM
 *   GET    /messaging/conversations                inbox
 *   GET    /messaging/conversations/:id            single conversation snapshot
 *   GET    /messaging/conversations/:id/messages   cursor-paginated messages
 *   PATCH  /messaging/conversations/:id/read       mark-as-read
 *   PATCH  /messaging/conversations/:id/unread     mark-as-unread (a flag; mark-read clears it)
 *   PATCH  /messaging/conversations/:id/mute       mute / unmute
 *   POST   /messaging/conversations/:id/leave      soft-leave (groups only; DMs 400)
 *   DELETE /messaging/messages/:id                 sender soft-deletes own
 *   GET    /messaging/unread-count                 global badge count
 *
 * All routes are JWT-protected. Safety gating (block/suspension/
 * new-account) lands in Stage 3.
 */
@ApiTags('Messaging')
@Controller('messaging')
@UseGuards(AuthGuard('jwt'))
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly safetyService: MessagingSafetyService,
    private readonly moderationService: MessagingModerationService,
  ) {}

  // POST /messaging/messages
  @Post('messages')
  // 30 sends per minute per user. Belt-and-braces with the Redis-backed
  // counter that lands in Stage 5.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiEndpoint(MessagingDocs.sendMessage)
  sendMessage(
    @Request() req: AuthenticatedRequest,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagingService.sendMessage(
      req.user.id,
      dto.recipientId,
      dto.body,
    );
  }

  // GET /messaging/conversations
  // Tighter than the global 100/60s — inbox refresh is a common poll
  // target and should be bounded per user even before SSE is up.
  @Get('conversations')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiEndpoint(MessagingDocs.listConversations)
  listConversations(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListConversationsDto,
  ) {
    return this.messagingService.listConversations(
      req.user.id,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  // GET /messaging/unread-count
  @Get('unread-count')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @ApiEndpoint(MessagingDocs.getUnreadCount)
  getUnreadCount(@Request() req: AuthenticatedRequest) {
    return this.messagingService.getUnreadCount(req.user.id);
  }

  // GET /messaging/conversations/:id
  @Get('conversations/:id')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @ApiEndpoint(MessagingDocs.getConversation)
  getConversation(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messagingService.getConversation(req.user.id, id);
  }

  // GET /messaging/conversations/:id/messages
  @Get('conversations/:id/messages')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @ApiEndpoint(MessagingDocs.listMessages)
  listMessages(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.messagingService.listMessages(req.user.id, id, {
      before: query.before,
      limit: query.limit ?? 50,
    });
  }

  // GET /messaging/messages/:id
  // Single-message lookup, for permalinks. 404s the same way as
  // listMessages when the caller is not a participant — no existence
  // leak.
  @Get('messages/:id')
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @ApiEndpoint(MessagingDocs.getMessage)
  getMessage(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messagingService.getMessage(req.user.id, id);
  }

  // PATCH /messaging/conversations/:id/read
  @Patch('conversations/:id/read')
  @ApiEndpoint(MessagingDocs.markRead)
  markRead(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.messagingService.markRead(req.user.id, id, dto.upToIso);
  }

  // PATCH /messaging/conversations/:id/unread
  @Patch('conversations/:id/unread')
  @ApiEndpoint(MessagingDocs.markUnread)
  markUnread(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messagingService.markUnread(req.user.id, id);
  }

  // PATCH /messaging/conversations/:id/mute
  @Patch('conversations/:id/mute')
  @ApiEndpoint(MessagingDocs.muteConversation)
  muteConversation(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MuteConversationDto,
  ) {
    return this.messagingService.muteConversation(
      req.user.id,
      id,
      dto.untilIso ?? null,
    );
  }

  // POST /messaging/conversations/:id/leave
  @Post('conversations/:id/leave')
  @ApiEndpoint(MessagingDocs.leaveConversation)
  async leave(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.messagingService.leave(req.user.id, id);
    return { ok: true };
  }

  // DELETE /messaging/messages/:id
  @Delete('messages/:id')
  @ApiEndpoint(MessagingDocs.deleteOwnMessage)
  deleteOwnMessage(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messagingService.deleteOwnMessage(req.user.id, id);
  }

  // ── Blocks ─────────────────────────────────────────────────────────

  // POST /messaging/blocks
  @Post('blocks')
  @ApiEndpoint(MessagingDocs.block)
  block(@Request() req: AuthenticatedRequest, @Body() dto: BlockUserDto) {
    return this.safetyService.block(req.user.id, dto.blockedId, dto.reason);
  }

  // GET /messaging/blocks
  @Get('blocks')
  @ApiEndpoint(MessagingDocs.listBlocks)
  listBlocks(@Request() req: AuthenticatedRequest) {
    return this.safetyService.listBlocks(req.user.id);
  }

  // DELETE /messaging/blocks/:blockedId
  @Delete('blocks/:blockedId')
  @ApiEndpoint(MessagingDocs.unblock)
  async unblock(
    @Request() req: AuthenticatedRequest,
    @Param('blockedId', ParseUUIDPipe) blockedId: string,
  ) {
    await this.safetyService.unblock(req.user.id, blockedId);
    return { ok: true };
  }

  // ── Reports ────────────────────────────────────────────────────────

  // POST /messaging/reports
  @Post('reports')
  // Tighter throttle: reports are abused as a harassment vector ("mass-
  // report someone"), 5/hour is plenty for legitimate use.
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiEndpoint(MessagingDocs.report)
  report(@Request() req: AuthenticatedRequest, @Body() dto: ReportMessageDto) {
    return this.moderationService.submitReport(req.user.id, {
      messageId: dto.messageId,
      conversationId: dto.conversationId,
      category: dto.category,
      notes: dto.notes,
    });
  }
}
