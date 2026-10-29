import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { ProgressDocs } from '../../common/docs/progress.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { RosterQueryDto, RosterWindow } from './dto/roster.query.dto';
import { ProgressService } from './progress.service';

/**
 * The coach's roster. Separate from ProgressController on purpose: that
 * one is strictly "my own training" and open to both roles, whereas this
 * is other people's data and INSTRUCTOR-only.
 *
 * Pathed under `coach/` to sit with the other coach reads
 * (`coach/clients/:id/workout-logs`) rather than under `progress/`.
 */
@ApiTags('Progress')
@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('INSTRUCTOR')
export class CoachRosterController {
  constructor(private readonly progressService: ProgressService) {}

  @Get('coach/roster')
  @ApiEndpoint(ProgressDocs.roster)
  async roster(
    @Request() req: AuthenticatedRequest,
    @Query() query: RosterQueryDto,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    return this.progressService.roster(
      req.user.id,
      query.window ?? RosterWindow.FourWeeks,
      today,
      query.clientId,
    );
  }
}
