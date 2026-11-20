import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AssignmentCopyDocs } from '../../common/docs/assignment-copy.docs';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';

import { AssignmentCopyService } from './assignment-copy.service';
import { AddPrescribedExercisesDto } from './dto/add-prescribed-exercises.dto';
import { MoveCopyDayDto, UpdateCopyExerciseDto } from './dto/client-copy.dto';
import { ReorderPrescribedRowsDto } from './dto/reorder-prescribed-rows.dto';
import { SetPrescribedSetsDto } from './dto/set-prescribed-sets.dto';

/**
 * A coach edits one client's copy of a plan: its upcoming days, for that
 * client only. INSTRUCTOR, and the service checks the caller is the plan's
 * coach and still coaches the client. One request per action.
 */
@ApiTags('Program assignments')
@Controller('program-assignments/:id/copy')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('INSTRUCTOR')
export class AssignmentCopyController {
  constructor(private readonly copyService: AssignmentCopyService) {}

  @Get()
  @ApiEndpoint(AssignmentCopyDocs.overview)
  async overview(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.copyService.overview(id, req.user.id);
  }

  /** Tell the client once about what changed since the last notice. */
  @Post('done')
  @HttpCode(200)
  @ApiEndpoint(AssignmentCopyDocs.done)
  async done(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.copyService.finishEditing(id, req.user.id);
  }

  @Get('days/:dayId')
  @ApiEndpoint(AssignmentCopyDocs.day)
  async day(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
  ) {
    return this.copyService.day(id, dayId, req.user.id);
  }

  @Patch('days/:dayId/date')
  @ApiEndpoint({ ...AssignmentCopyDocs.moveDay, body: MoveCopyDayDto })
  async moveDay(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Body() dto: MoveCopyDayDto,
  ) {
    return this.copyService.moveDay(id, dayId, dto, req.user.id);
  }

  @Post('days/:dayId/exercises/bulk')
  @Throttle({ default: { limit: 200, ttl: 3_600_000 } })
  @ApiEndpoint({
    ...AssignmentCopyDocs.addExercises,
    body: AddPrescribedExercisesDto,
  })
  async addExercises(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Body() dto: AddPrescribedExercisesDto,
  ) {
    return this.copyService.addExercises(id, dayId, dto, req.user.id);
  }

  // Before `exercises/:exerciseId`, which would read "reorder" as an id.
  @Patch('days/:dayId/exercises/reorder')
  @ApiEndpoint({
    ...AssignmentCopyDocs.reorder,
    body: ReorderPrescribedRowsDto,
  })
  async reorder(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Body() dto: ReorderPrescribedRowsDto,
  ) {
    return this.copyService.reorderExercises(id, dayId, dto, req.user.id);
  }

  @Patch('days/:dayId/exercises/:exerciseId')
  @ApiEndpoint({
    ...AssignmentCopyDocs.updateExercise,
    body: UpdateCopyExerciseDto,
  })
  async updateExercise(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Body() dto: UpdateCopyExerciseDto,
  ) {
    return this.copyService.updateExercise(
      id,
      dayId,
      exerciseId,
      dto,
      req.user.id,
    );
  }

  @Delete('days/:dayId/exercises/:exerciseId')
  @HttpCode(204)
  @ApiEndpoint(AssignmentCopyDocs.removeExercise)
  async removeExercise(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
  ): Promise<void> {
    await this.copyService.removeExercise(id, dayId, exerciseId, req.user.id);
  }

  @Post('days/:dayId/exercises/:exerciseId/revert')
  @ApiEndpoint(AssignmentCopyDocs.revert)
  async revert(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
  ) {
    return this.copyService.revert(id, dayId, exerciseId, req.user.id);
  }

  /** Every set of one exercise, matched by id and updated in place. */
  @Put('days/:dayId/exercises/:exerciseId/sets')
  @ApiEndpoint({ ...AssignmentCopyDocs.setSets, body: SetPrescribedSetsDto })
  async setSets(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Body() dto: SetPrescribedSetsDto,
  ) {
    return this.copyService.setSets(id, dayId, exerciseId, dto, req.user.id);
  }
}
