import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { ProgressDocs } from '../../common/docs/progress.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { requestLocale } from '../../common/i18n';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { ProgressOverviewQueryDto } from './dto/progress-overview.query.dto';
import { ProgressRange } from './dto/progress-range.enum';
import { ProgressService } from './progress.service';

/**
 * A coach reading one client's Progress screen. Same response shapes as
 * ProgressController, so the apps reuse the trainee screens unchanged.
 *
 * INSTRUCTOR-only and pathed under `coach/clients/:clientId` beside the
 * coach's log reads. Access is decided in the service by
 * CoachAccessService: 404 unless the caller is the client's ACTIVE
 * coach, and the numbers cover only the logs that coach may read.
 */
@ApiTags('Progress')
@Controller('coach/clients/:clientId/progress')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('INSTRUCTOR')
export class CoachClientProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get('overview')
  @ApiEndpoint(ProgressDocs.clientOverview)
  async overview(
    @Request() req: AuthenticatedRequest,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() query: ProgressOverviewQueryDto,
  ) {
    return this.progressService.overviewForCoach(
      req.user.id,
      clientId,
      query.range ?? ProgressRange.TwelveWeeks,
      requestLocale(req),
    );
  }

  @Get('exercises/:exerciseId')
  @ApiEndpoint(ProgressDocs.clientExerciseHistory)
  async exerciseHistory(
    @Request() req: AuthenticatedRequest,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
  ) {
    return this.progressService.exerciseHistoryForCoach(
      req.user.id,
      clientId,
      exerciseId,
    );
  }
}
