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
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { SessionService } from './session.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { UpdateParticipantStatusDto } from './dto/update-participant-status.dto';
import { CloneSessionDto } from './dto/clone-session.dto';
import { RescheduleSessionDto } from './dto/reschedule-session.dto';
import { DiscoverSessionsDto } from './dto/discover-sessions.dto';
import { GenerateInstancesDto } from './dto/generate-instances.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { SessionDocs } from '../../common/docs/session.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Session Controller
 *
 * Training session management:
 * - POST   /sessions                              → Create session (INSTRUCTOR)
 * - GET    /sessions                              → List my visible sessions
 * - GET    /sessions/discover                     → Discover public sessions
 * - GET    /sessions/:id                          → Get session details
 * - PATCH  /sessions/:id                          → Update session (instructor only)
 * - DELETE /sessions/:id                          → Delete session (instructor only)
 * - POST   /sessions/:id/clone                    → Clone/duplicate a session
 * - POST   /sessions/:id/join                     → Join session (participant)
 * - POST   /sessions/:id/leave                    → Leave session (participant)
 * - POST   /sessions/:id/confirm                  → Confirm registration
 * - POST   /sessions/:id/checkin                  → Self check-in
 * - PATCH  /sessions/:id/participants/:userId     → Update participant status (instructor)
 */
@ApiTags('Sessions')
@Controller('sessions')
@UseGuards(AuthGuard('jwt'))
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  // =====================================================
  // SESSION CRUD
  // =====================================================

  @Post()
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...SessionDocs.create, body: CreateSessionDto })
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessionService.create(req.user.id, dto);
  }

  @Get()
  @ApiEndpoint(SessionDocs.getMySessions)
  async getMySessions(
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    return this.sessionService.getMySessions(
      req.user.id,
      pagination.page,
      pagination.limit,
    );
  }

  @Get('discover')
  @ApiEndpoint(SessionDocs.discoverSessions)
  async discoverSessions(@Query() query: DiscoverSessionsDto) {
    return this.sessionService.discoverSessions(query.page, query.limit, {
      search: query.search,
      sessionType: query.sessionType,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      maxDurationMinutes: query.maxDurationMinutes,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  @Get('calendar')
  @ApiEndpoint({
    summary: 'Calendar view',
    description:
      'Get sessions grouped by date for a date range. Returns { "2026-03-10": [...sessions] }.',
    auth: true,
    responses: [{ status: 200, description: 'Sessions grouped by date' }],
  })
  async getCalendar(
    @Request() req: AuthenticatedRequest,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.sessionService.getCalendar(req.user.id, start, end);
  }

  @Get(':id')
  @ApiEndpoint(SessionDocs.getById)
  async getById(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.sessionService.getById(id, req.user.id);
  }

  @Patch(':id')
  @ApiEndpoint({ ...SessionDocs.update, body: UpdateSessionDto })
  async update(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessionService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiEndpoint(SessionDocs.delete)
  async delete(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    await this.sessionService.delete(id, req.user.id);
    return { message: 'Session deleted successfully' };
  }

  @Post(':id/clone')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...SessionDocs.cloneSession, body: CloneSessionDto })
  async cloneSession(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: CloneSessionDto,
  ) {
    return this.sessionService.cloneSession(id, req.user.id, dto.scheduledAt);
  }

  @Get(':id/recurrence-preview')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(SessionDocs.recurrencePreview)
  async getRecurrencePreview(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Query('weeks') weeks?: string,
  ) {
    const numWeeks = weeks
      ? Math.min(52, Math.max(1, parseInt(weeks, 10) || 12))
      : 12;
    return this.sessionService.getRecurrencePreview(id, req.user.id, numWeeks);
  }

  @Post(':id/generate-instances')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...SessionDocs.generateInstances, body: GenerateInstancesDto })
  async generateInstances(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: GenerateInstancesDto,
  ) {
    return this.sessionService.generateUpcomingInstances(
      id,
      req.user.id,
      dto.weeks ?? 12,
    );
  }

  @Patch(':id/reschedule')
  @ApiEndpoint({
    summary: 'Reschedule a session',
    description:
      'Update the scheduled time and notify all participants. Instructor only.',
    auth: true,
    responses: [
      { status: 200, description: 'Session rescheduled successfully' },
    ],
    body: RescheduleSessionDto,
  })
  async reschedule(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: RescheduleSessionDto,
  ) {
    return this.sessionService.rescheduleSession(
      id,
      req.user.id,
      dto.scheduledAt,
      dto.reason,
    );
  }

  // =====================================================
  // PARTICIPANT MANAGEMENT
  // =====================================================

  @Post(':id/join')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiEndpoint(SessionDocs.joinSession)
  async joinSession(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.sessionService.joinSession(id, req.user.id);
  }

  @Post(':id/leave')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiEndpoint(SessionDocs.leaveSession)
  async leaveSession(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.sessionService.leaveSession(id, req.user.id);
    return { message: 'You have left the session' };
  }

  @Post(':id/confirm')
  @ApiEndpoint(SessionDocs.confirmRegistration)
  async confirmRegistration(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.sessionService.confirmRegistration(id, req.user.id);
  }

  @Post(':id/checkin')
  @ApiEndpoint(SessionDocs.selfCheckIn)
  async selfCheckIn(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.sessionService.selfCheckIn(id, req.user.id);
  }

  @Patch(':id/participants/:userId')
  @ApiEndpoint({
    ...SessionDocs.updateParticipantStatus,
    body: UpdateParticipantStatusDto,
  })
  async updateParticipantStatus(
    @Param('id') sessionId: string,
    @Param('userId') participantUserId: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateParticipantStatusDto,
  ) {
    return this.sessionService.updateParticipantStatus(
      sessionId,
      participantUserId,
      req.user.id,
      dto,
    );
  }
}
