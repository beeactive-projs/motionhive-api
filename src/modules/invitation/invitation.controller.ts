import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { InvitationService } from './invitation.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InviteMembersDto } from './dto/invite-members.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { InvitationDocs } from '../../common/docs/invitation.docs';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Invitation Controller
 *
 * Manages invitations to join groups:
 * - POST   /invitations                → Send invitation (group owner)
 * - POST   /invitations/bulk           → Invite several of my clients (group owner)
 * - GET    /invitations/pending        → My pending invitations
 * - POST   /invitations/mine/:id/accept  → Accept one of mine in the app
 * - POST   /invitations/mine/:id/decline → Decline one of mine in the app
 * - POST   /invitations/:token/accept  → Accept invitation
 * - POST   /invitations/:token/decline → Decline invitation
 * - POST   /invitations/:id/cancel     → Cancel invitation (group owner)
 * - POST   /invitations/:id/resend     → Resend invitation email (group owner)
 * - GET    /invitations/group/:id      → List group invitations (owner)
 */
@ApiTags('Invitations')
@Controller('invitations')
@UseGuards(AuthGuard('jwt'))
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @ApiEndpoint({ ...InvitationDocs.create, body: CreateInvitationDto })
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationService.create(req.user.id, dto);
  }

  @Post('bulk')
  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @ApiEndpoint({ ...InvitationDocs.inviteMembers, body: InviteMembersDto })
  async inviteMembers(
    @Request() req: AuthenticatedRequest,
    @Body() dto: InviteMembersDto,
  ) {
    return this.invitationService.inviteMembers(req.user.id, dto);
  }

  @Post('mine/:id/accept')
  @ApiEndpoint(InvitationDocs.acceptMine)
  async acceptMine(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.invitationService.acceptMine(
      id,
      req.user.id,
      req.user.email,
      req.user.isEmailVerified,
    );
  }

  @Post('mine/:id/decline')
  @ApiEndpoint(InvitationDocs.declineMine)
  async declineMine(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.invitationService.declineMine(
      id,
      req.user.id,
      req.user.email,
      req.user.isEmailVerified,
    );
  }

  @Get('pending')
  @ApiEndpoint(InvitationDocs.getMyPendingInvitations)
  async getMyPendingInvitations(
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    return this.invitationService.getMyPendingInvitations(
      req.user.id,
      req.user.email,
      req.user.isEmailVerified,
      pagination.page,
      pagination.limit,
    );
  }

  @Post(':token/accept')
  @ApiEndpoint(InvitationDocs.accept)
  async accept(
    @Param('token') token: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.invitationService.accept(token, req.user.id, req.user.email);
  }

  @Post(':token/decline')
  @ApiEndpoint(InvitationDocs.decline)
  async decline(
    @Param('token') token: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.invitationService.decline(token, req.user.email);
  }

  @Post(':id/cancel')
  @ApiEndpoint(InvitationDocs.cancel)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.invitationService.cancel(id, req.user.id);
  }

  @Post(':id/resend')
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @ApiEndpoint(InvitationDocs.resend)
  async resend(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.invitationService.resend(id, req.user.id);
  }

  @Get('group/:id')
  @ApiEndpoint(InvitationDocs.getGroupInvitations)
  async getGroupInvitations(
    @Param('id', ParseUUIDPipe) groupId: string,
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    return this.invitationService.getGroupInvitations(
      groupId,
      req.user.id,
      pagination.page,
      pagination.limit,
    );
  }
}
