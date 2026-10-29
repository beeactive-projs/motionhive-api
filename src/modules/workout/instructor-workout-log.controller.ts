import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';

import { CoachClientLogsQueryDto } from './dto/coach-client-logs.query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { requestLocale } from '../../common/i18n';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutPhotoService } from './workout-photo.service';
import { sendPrivateImage } from './workout-photo.http';

/**
 * Coach-side read access to a client's workout logs.
 *
 * Gated by an ACTIVE instructor_client relationship — 404 (not 403) on
 * any other state, to avoid leaking that the user/client exists.
 *
 * Kept in its own controller (not bolted onto WorkoutLogController) so
 * the role decorator can flip from USER → INSTRUCTOR without affecting
 * the client surface.
 */
@ApiTags('Workout logs (coach)')
@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('INSTRUCTOR')
export class InstructorWorkoutLogController {
  constructor(
    private readonly workoutLogService: WorkoutLogService,
    private readonly workoutPhotoService: WorkoutPhotoService,
  ) {}

  @Get('coach/clients/:clientId/workout-logs')
  async listForClient(
    @Request() req: AuthenticatedRequest,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() query: CoachClientLogsQueryDto,
  ) {
    return this.workoutLogService.listForClientByInstructor(
      req.user.id,
      clientId,
      query,
    );
  }

  /** The workout's photo, when the coach may open the workout itself. */
  @Get('coach/workout-logs/:id/photo')
  async photo(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    sendPrivateImage(
      res,
      await this.workoutPhotoService.photoForCoach(id, req.user.id),
    );
  }

  @Get('coach/workout-logs/:id')
  async get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workoutLogService.findByIdForInstructor(
      id,
      req.user.id,
      requestLocale(req),
    );
  }
}
