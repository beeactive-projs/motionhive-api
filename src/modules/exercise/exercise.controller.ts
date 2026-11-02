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
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { ExerciseDocs } from '../../common/docs/exercise.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  Principal,
  type PrincipalContext,
} from '../../common/decorators/principal.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';

import { ExerciseService } from './exercise.service';
import { ExerciseNoteService } from './exercise-note.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { UpdateExerciseNoteDto } from './dto/update-exercise-note.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';
import { ListExercisesQueryDto } from './dto/list-exercises.query.dto';

/**
 * Exercise Catalog — instructor + client surface.
 *
 * `GET` endpoints accept both INSTRUCTOR and USER roles; the service
 * gates clients via `assertClientCanBrowse` (locked decision §19).
 *
 * Create, update and delete are open to everyone since workouts round 2:
 * someone training without a coach makes their own exercises, which are
 * always PRIVATE (source USER). Fork stays INSTRUCTOR-only. The personal
 * note (`:id/note`) is the caller's own and never shown to a coach.
 */
@ApiTags('Exercises')
@Controller('exercises')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ExerciseController {
  constructor(
    private readonly exerciseService: ExerciseService,
    private readonly exerciseNoteService: ExerciseNoteService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────

  @Get()
  @Roles('INSTRUCTOR', 'USER')
  @ApiEndpoint(ExerciseDocs.list)
  async list(
    @Principal() principal: PrincipalContext,
    @Query() query: ListExercisesQueryDto,
  ) {
    if (!principal.isInstructor) {
      await this.exerciseService.assertClientCanBrowse(principal);
    }
    return this.exerciseService.list(query, principal);
  }

  @Get(':id')
  @Roles('INSTRUCTOR', 'USER')
  @ApiEndpoint(ExerciseDocs.get)
  async get(
    @Principal() principal: PrincipalContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exerciseService.findById(id, principal);
  }

  // ── The caller's private note ─────────────────────────────────────

  @Get(':id/note')
  @Roles('INSTRUCTOR', 'USER')
  @ApiEndpoint(ExerciseDocs.getNote)
  async getNote(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exerciseNoteService.get(id, req.user.id);
  }

  @Put(':id/note')
  @Roles('INSTRUCTOR', 'USER')
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  @ApiEndpoint({ ...ExerciseDocs.putNote, body: UpdateExerciseNoteDto })
  async putNote(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExerciseNoteDto,
  ) {
    return this.exerciseNoteService.put(id, req.user.id, dto.note);
  }

  // ── Write (owner; fork is coaches only) ───────────────────────────

  @Post()
  @Roles('INSTRUCTOR', 'USER')
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  @ApiEndpoint({ ...ExerciseDocs.create, body: CreateExerciseDto })
  async create(
    @Principal() principal: PrincipalContext,
    @Body() dto: CreateExerciseDto,
  ) {
    return this.exerciseService.create(
      dto,
      principal.userId,
      principal.isInstructor,
    );
  }

  @Patch(':id')
  @Roles('INSTRUCTOR', 'USER')
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  @ApiEndpoint({ ...ExerciseDocs.update, body: UpdateExerciseDto })
  async update(
    @Principal() principal: PrincipalContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExerciseDto,
  ) {
    return this.exerciseService.update(id, dto, principal);
  }

  @Delete(':id')
  @Roles('INSTRUCTOR', 'USER')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint(ExerciseDocs.remove)
  async remove(
    @Principal() principal: PrincipalContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.exerciseService.softDelete(id, principal);
  }

  @Post(':id/fork')
  @Roles('INSTRUCTOR')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint(ExerciseDocs.fork)
  async fork(
    @Principal() principal: PrincipalContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exerciseService.fork(id, principal);
  }
}
