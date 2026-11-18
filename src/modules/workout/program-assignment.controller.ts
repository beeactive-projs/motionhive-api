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
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';

import { AssignProgramDto } from './dto/assign-program.dto';
import { ListAssignmentsQueryDto } from './dto/list-assignments.query.dto';
import { ScheduleRoutineDto } from './dto/schedule-routine.dto';
import { TrainingDayQueryDto } from './dto/training-day.query.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { ProgramAssignmentService } from './program-assignment.service';

/**
 * Program assignments — mixed instructor + client surface.
 *
 * Auth gates per route. `/program-assignments` is INSTRUCTOR;
 * `/my/program-assignments` is USER. Detail (`:id`) accepts either
 * role and the service checks the caller is one of the two parties.
 */
@ApiTags('Program assignments')
@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProgramAssignmentController {
  constructor(private readonly assignmentService: ProgramAssignmentService) {}

  // ── Instructor surface ───────────────────────────────────────────

  @Post('program-assignments')
  @Roles('INSTRUCTOR')
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  async assign(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AssignProgramDto,
  ) {
    const instructorName = [req.user.firstName, req.user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return this.assignmentService.assignProgramToClient(
      req.user.id,
      instructorName,
      dto,
    );
  }

  @Get('program-assignments')
  @Roles('INSTRUCTOR')
  async listAsInstructor(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListAssignmentsQueryDto,
  ) {
    return this.assignmentService.listForInstructor(req.user.id, query);
  }

  @Patch('program-assignments/:id')
  @Roles('INSTRUCTOR')
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.assignmentService.update(id, dto, req.user.id);
  }

  @Delete('program-assignments/:id')
  @Roles('INSTRUCTOR')
  @HttpCode(204)
  async remove(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.assignmentService.softDelete(id, req.user.id);
  }

  // ── Client surface ───────────────────────────────────────────────

  /**
   * The Workouts front door. One read so the surface doesn't N+1 its
   * way through every assignment looking for today.
   */
  @Get('my/workouts/today')
  @Roles('USER', 'INSTRUCTOR')
  async trainingDay(
    @Request() req: AuthenticatedRequest,
    @Query() query: TrainingDayQueryDto,
  ) {
    const today = query.date ?? new Date().toISOString().slice(0, 10);
    return this.assignmentService.getTrainingDay(req.user.id, today);
  }

  /**
   * Schedule one of your own routines across the week. Self-assignment:
   * the same machinery a coach uses, with no coach involved.
   */
  @Post('my/scheduled-routines')
  @Roles('USER', 'INSTRUCTOR')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  async scheduleRoutine(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ScheduleRoutineDto,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    return this.assignmentService.scheduleRoutine(req.user.id, dto, today);
  }

  @Get('my/program-assignments')
  @Roles('USER')
  async listAsClient(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListAssignmentsQueryDto,
  ) {
    return this.assignmentService.listForClient(req.user.id, query);
  }

  /**
   * Client manually skips an assigned workout. Locked V1 decision:
   * skip is both auto-derived (passed date, no log) and manual.
   */
  @Post('my/assigned-workouts/:id/skip')
  @Roles('USER')
  async skipAsClient(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assignmentService.skipAssignedWorkoutAsClient(id, req.user.id);
  }

  // ── Shared (either party) ────────────────────────────────────────

  @Get('program-assignments/:id')
  @Roles('INSTRUCTOR', 'USER')
  async get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assignmentService.findById(id, req.user.id);
  }
}
