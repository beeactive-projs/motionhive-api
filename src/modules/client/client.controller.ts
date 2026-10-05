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
import { parseUuidOrNotFound } from '../../common/pipes/parse-uuid-or-404.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { ClientDocs } from '../../common/docs/client.docs';
import { FilterSettingsDto } from '../../common/dto/filter-settings.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { ClientService } from './client.service';
import { AcceptByTokenDto } from './dto/accept-by-token.dto';
import { CreateClientRequestDto } from './dto/create-client-request.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { RequestClientDto } from './dto/request-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { InstructorClientStatus } from './entities/instructor-client.entity';

/**
 * Client Controller
 *
 * Manages instructor-client relationships:
 * - POST   /clients/filter                            → PrimeNG server-side filter (INSTRUCTOR)
 * - GET    /clients                                  → List my clients (INSTRUCTOR)
 * - GET    /clients/my-instructors                   → List instructors I'm a client of
 * - GET    /clients/requests/pending                 → List my pending incoming requests
 * - GET    /clients/invites                          → List pending email-only invitations (INSTRUCTOR)
 * - GET    /clients/invite/:token                    → Get invite details by token (PUBLIC)
 * - POST   /clients/invite                           → Send client invitation (INSTRUCTOR)
 * - POST   /clients/request/:instructorId            → Request to become a client
 * - POST   /clients/requests/:requestId/accept       → Accept a request
 * - POST   /clients/requests/:requestId/decline      → Decline a request
 * - POST   /clients/requests/:requestId/cancel       → Cancel own request
 * - POST   /clients/requests/accept-by-token         → Accept invite via referral token (new user)
 * - PATCH  /clients/:clientId                        → Update client notes/status (INSTRUCTOR)
 * - DELETE /clients/:clientId                        → Archive client relationship (INSTRUCTOR)
 */
@ApiTags('Clients')
@Controller('clients')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  /**
   * POST /clients/filter
   * PrimeNG server-side filtered, sorted, and paginated client table.
   * Accepts the full TableLazyLoadEvent as the request body.
   */
  @Post('filter')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.filterClients)
  filterClients(
    @Request() req: AuthenticatedRequest,
    @Body() dto: FilterSettingsDto,
  ) {
    return this.clientService.filterClients(req.user.id, dto);
  }

  /**
   * POST /clients/requests/filter
   * PrimeNG server-side filtered, sorted, and paginated pending requests table.
   * Returns client_request rows where the authenticated instructor is either
   * sender (INSTRUCTOR_TO_CLIENT) or recipient (CLIENT_TO_INSTRUCTOR), with
   * status PENDING and not yet expired. Rows are normalised into the same
   * shape as the clients table consumes.
   */
  @Post('requests/filter')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.filterPendingRequests)
  filterPendingRequests(
    @Request() req: AuthenticatedRequest,
    @Body() dto: FilterSettingsDto,
  ) {
    return this.clientService.filterPendingRequests(req.user.id, dto);
  }

  /**
   * GET /clients
   * List the authenticated instructor's clients with pagination and optional status filter.
   */
  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.getMyClients)
  async getMyClients(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListClientsDto,
  ) {
    return this.clientService.getMyClients(req.user.id, {
      status: query.status,
      direction: query.direction,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * GET /clients/my-instructors
   * List all instructors the authenticated user is a client of.
   */
  @Get('my-instructors')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ClientDocs.getMyInstructors)
  async getMyInstructors(@Request() req: AuthenticatedRequest) {
    return this.clientService.getMyInstructors(req.user.id);
  }

  /**
   * DELETE /clients/my-instructors/:instructorId
   * Client-initiated: end the relationship with the given instructor.
   * Archives the instructor_client row.
   */
  @Delete('my-instructors/:instructorId')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({
    summary: 'Leave instructor',
    description:
      'End the relationship with the given instructor. Archives the relationship on both sides.',
    auth: true,
    responses: [
      { status: 200, description: 'Relationship archived' },
      { status: 404, description: 'Relationship not found' },
    ],
  })
  async leaveInstructor(
    @Request() req: AuthenticatedRequest,
    @Param('instructorId', ParseUUIDPipe) instructorId: string,
  ) {
    return this.clientService.leaveInstructor(req.user.id, instructorId);
  }

  /**
   * GET /clients/requests/pending
   * List pending requests addressed TO the authenticated user — incoming
   * only, in either role. This is NOT the same population as
   * `requests/pending/count`, which also counts the invitations the caller
   * sent; see that handler. To list a coach's outgoing invitations, use
   * `GET /clients?status=PENDING&direction=outgoing`.
   */
  @Get('requests/pending')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ClientDocs.getPendingRequests)
  async getPendingRequests(@Request() req: AuthenticatedRequest) {
    return this.clientService.getPendingRequests(req.user.id);
  }

  /**
   * GET /clients/requests/pending/count
   * Counts pending client_request rows in BOTH directions — invitations the
   * instructor sent and requests addressed to them — and reports each
   * separately alongside the total.
   *
   * The total alone read as a contradiction next to
   * `GET /clients/requests/pending`, which lists incoming rows only: one
   * outgoing invitation made the badge say "1 pending" over an empty list.
   * Same numbers, but now the shape says which is which.
   */
  @Get('requests/pending/count')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.getPendingRequestsCount)
  getPendingRequestsCount(@Request() req: AuthenticatedRequest) {
    return this.clientService.getPendingRequestsCount(req.user.id);
  }

  /**
   * GET /clients/invites
   * List pending email-only invitations sent by this instructor.
   * These are people who were invited but haven't registered yet.
   * Add ?includeExpired=true to also see expired/cancelled invitations.
   */
  @Get('invites')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.getPendingEmailInvites)
  async getPendingEmailInvites(
    @Request() req: AuthenticatedRequest,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.clientService.getPendingEmailInvites(
      req.user.id,
      includeExpired === 'true',
    );
  }

  /**
   * GET /clients/invite/:token
   * Public endpoint — returns invite details so the signup page can pre-fill
   * the invited email and show the instructor's name.
   */
  @Get('invite/:token')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiEndpoint(ClientDocs.getInviteByToken)
  async getInviteByToken(@Param('token') token: string) {
    return this.clientService.getInviteByToken(token);
  }

  /**
   * POST /clients/invite
   * Instructor sends an invitation to a user to become their client.
   */
  @Post('invite')
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...ClientDocs.sendInvitation, body: CreateClientRequestDto })
  async sendInvitation(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateClientRequestDto,
  ) {
    return this.clientService.sendInvitationFromDto(req.user.id, dto);
  }

  /**
   * POST /clients/invite/:requestId/resend
   * Resend an existing client invitation (INSTRUCTOR only).
   * Refreshes expiry (+30 days), regenerates token for email-only invites, re-sends the email.
   */
  @Post('invite/:requestId/resend')
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.resendInvitation)
  async resendInvitation(
    @Request() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.clientService.resendInvitation(req.user.id, requestId);
  }

  /**
   * POST /clients/request/:instructorId
   * User requests to become a client of the specified instructor.
   */
  @Post('request/:instructorId')
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ClientDocs.requestToBeClient)
  async requestToBeClient(
    @Request() req: AuthenticatedRequest,
    @Param('instructorId', ParseUUIDPipe) instructorId: string,
    @Body() dto: RequestClientDto,
  ) {
    return this.clientService.requestToBeClient(
      req.user.id,
      instructorId,
      dto.message,
    );
  }

  /**
   * POST /clients/requests/accept-by-token
   * Called immediately after signup via a referral link.
   * Links the newly created account to the pending ClientRequest and marks it ACCEPTED.
   */
  @Post('requests/accept-by-token')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ClientDocs.acceptByToken)
  async acceptByToken(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AcceptByTokenDto,
  ) {
    return this.clientService.acceptByToken(dto.token, req.user.id);
  }

  /**
   * POST /clients/requests/:requestId/accept
   * Accept a pending client request.
   */
  @Post('requests/:requestId/accept')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ClientDocs.acceptRequest)
  async acceptRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.clientService.acceptRequest(requestId, req.user.id);
  }

  /**
   * POST /clients/requests/:requestId/decline
   * Decline a pending client request.
   */
  @Post('requests/:requestId/decline')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ClientDocs.declineRequest)
  async declineRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.clientService.declineRequest(requestId, req.user.id);
  }

  /**
   * POST /clients/requests/:requestId/cancel
   * Cancel a request that the authenticated user sent.
   */
  @Post('requests/:requestId/cancel')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ClientDocs.cancelRequest)
  async cancelRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.clientService.cancelRequest(requestId, req.user.id);
  }

  /**
   * GET /clients/:clientId
   * One client of the authenticated instructor, in the same shape the
   * list returns. Lets the client profile be opened by URL — from the
   * roster, a bookmark, or a refresh — instead of only from the table.
   *
   * Declared after every literal `@Get` above it: a wildcard param route
   * registered earlier would swallow `/clients/invites` and friends. A
   * segment that is not a UUID still lands here, so the pipe answers 404
   * rather than complaining about a uuid the caller never meant to send.
   */
  @Get(':clientId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.getClient)
  async getClient(
    @Request() req: AuthenticatedRequest,
    @Param('clientId', parseUuidOrNotFound()) clientId: string,
  ) {
    return this.clientService.getClientForInstructor(req.user.id, clientId);
  }

  /**
   * PATCH /clients/:clientId
   * Update notes or status for a client relationship (INSTRUCTOR only).
   */
  @Patch(':clientId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...ClientDocs.updateClient, body: UpdateClientDto })
  async updateClient(
    @Request() req: AuthenticatedRequest,
    @Param('clientId', parseUuidOrNotFound()) clientId: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientService.updateClient(req.user.id, clientId, dto);
  }

  /**
   * DELETE /clients/:clientId
   * Archive (soft-remove) a client relationship (INSTRUCTOR only).
   * This is equivalent to setting status to ARCHIVED.
   */
  @Delete(':clientId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.archiveClient)
  async archiveClient(
    @Request() req: AuthenticatedRequest,
    @Param('clientId', parseUuidOrNotFound()) clientId: string,
  ) {
    return this.clientService.updateClient(req.user.id, clientId, {
      status: InstructorClientStatus.ARCHIVED,
    });
  }
}
