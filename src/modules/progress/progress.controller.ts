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
 * Progress — everything is scoped to the caller. There is no surface
 * here for reading someone else's progress: a coach sees their client's
 * logs through the coach endpoints, and only while the relationship is
 * active.
 *
 * Open to INSTRUCTOR as well as USER because coaches train too.
 */
@ApiTags('Progress')
@Controller('progress')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('USER', 'INSTRUCTOR')
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get('overview')
  @ApiEndpoint(ProgressDocs.overview)
  async overview(
    @Request() req: AuthenticatedRequest,
    @Query() query: ProgressOverviewQueryDto,
  ) {
    return this.progressService.overview(
      req.user.id,
      query.range ?? ProgressRange.TwelveWeeks,
      requestLocale(req),
    );
  }

  @Get('exercises')
  @ApiEndpoint(ProgressDocs.trainedExercises)
  async trainedExercises(@Request() req: AuthenticatedRequest) {
    return this.progressService.trainedExercises(
      req.user.id,
      requestLocale(req),
    );
  }

  @Get('exercises/:exerciseId')
  @ApiEndpoint(ProgressDocs.exerciseHistory)
  async exerciseHistory(
    @Request() req: AuthenticatedRequest,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
  ) {
    return this.progressService.exerciseHistory(req.user.id, exerciseId);
  }
}
