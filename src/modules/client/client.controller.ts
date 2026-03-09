import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientService } from './client.service';
import { CreateClientRequestDto } from './dto/create-client-request.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { ClientDocs } from '../../common/docs/client.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * Client Controller
 *
 * Manages instructor-client relationships:
 * - GET    /clients                             → List my clients (INSTRUCTOR)
 * - GET    /clients/my-instructors              → List instructors I'm a client of
 * - GET    /clients/requests/pending            → List my pending incoming requests
 * - POST   /clients/invite                      → Send client invitation (INSTRUCTOR)
 * - POST   /clients/request/:instructorId       → Request to become a client
 * - POST   /clients/requests/:requestId/accept  → Accept a request
 * - POST   /clients/requests/:requestId/decline → Decline a request
 * - POST   /clients/requests/:requestId/cancel  → Cancel own request
 * - PATCH  /clients/:clientId                   → Update client notes/status (INSTRUCTOR)
 * - DELETE /clients/:clientId                   → Archive client relationship (INSTRUCTOR)
 */
@ApiTags('Clients')
@Controller('clients')
@UseGuards(AuthGuard('jwt'))
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  /**
   * GET /clients
   * List the authenticated instructor's clients with pagination and optional status filter.
   */
  @Get()
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.getMyClients)
  async getMyClients(@Request() req, @Query() query: ListClientsDto) {
    return this.clientService.getMyClients(req.user.id, {
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * GET /clients/my-instructors
   * List all instructors the authenticated user is a client of.
   */
  @Get('my-instructors')
  @ApiEndpoint(ClientDocs.getMyInstructors)
  async getMyInstructors(@Request() req) {
    return this.clientService.getMyInstructors(req.user.id);
  }

  /**
   * GET /clients/requests/pending
   * List pending incoming requests for the authenticated user.
   */
  @Get('requests/pending')
  @ApiEndpoint(ClientDocs.getPendingRequests)
  async getPendingRequests(@Request() req) {
    return this.clientService.getPendingRequests(req.user.id);
  }

  /**
   * POST /clients/invite
   * Instructor sends an invitation to a user to become their client.
   */
  @Post('invite')
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...ClientDocs.sendInvitation, body: CreateClientRequestDto })
  async sendInvitation(@Request() req, @Body() dto: CreateClientRequestDto) {
    return this.clientService.sendClientInvitationByEmail(
      req.user.id,
      dto.email,
      dto.message,
    );
  }

  /**
   * POST /clients/request/:instructorId
   * User requests to become a client of the specified instructor.
   */
  @Post('request/:instructorId')
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @ApiEndpoint(ClientDocs.requestToBeClient)
  async requestToBeClient(
    @Request() req,
    @Param('instructorId') instructorId: string,
    @Body() dto: { message?: string },
  ) {
    return this.clientService.requestToBeClient(
      req.user.id,
      instructorId,
      dto.message,
    );
  }

  /**
   * POST /clients/requests/:requestId/accept
   * Accept a pending client request.
   */
  @Post('requests/:requestId/accept')
  @ApiEndpoint(ClientDocs.acceptRequest)
  async acceptRequest(@Param('requestId') requestId: string, @Request() req) {
    return this.clientService.acceptRequest(requestId, req.user.id);
  }

  /**
   * POST /clients/requests/:requestId/decline
   * Decline a pending client request.
   */
  @Post('requests/:requestId/decline')
  @ApiEndpoint(ClientDocs.declineRequest)
  async declineRequest(@Param('requestId') requestId: string, @Request() req) {
    return this.clientService.declineRequest(requestId, req.user.id);
  }

  /**
   * POST /clients/requests/:requestId/cancel
   * Cancel a request that the authenticated user sent.
   */
  @Post('requests/:requestId/cancel')
  @ApiEndpoint(ClientDocs.cancelRequest)
  async cancelRequest(@Param('requestId') requestId: string, @Request() req) {
    return this.clientService.cancelRequest(requestId, req.user.id);
  }

  /**
   * PATCH /clients/:clientId
   * Update notes or status for a client relationship (INSTRUCTOR only).
   */
  @Patch(':clientId')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...ClientDocs.updateClient, body: UpdateClientDto })
  async updateClient(
    @Request() req,
    @Param('clientId') clientId: string,
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
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(ClientDocs.archiveClient)
  async archiveClient(@Request() req, @Param('clientId') clientId: string) {
    return this.clientService.updateClient(req.user.id, clientId, {
      status: 'ARCHIVED',
    });
  }
}
