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
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { VenueDocs } from '../../common/docs/venue.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';

import { VenueService } from './venue.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { Venue } from './entities/venue.entity';

/**
 * VenueController — instructor-facing CRUD for venues.
 *
 * All routes require a JWT + the INSTRUCTOR role. Ownership is
 * enforced in the service layer (never in the controller) so a
 * malicious or buggy client cannot pass another instructor's id
 * and have the controller forward it.
 *
 * Write endpoints are throttled per-user to blunt accidental loops
 * from a misbehaving FE (e.g. a retry storm on network flake).
 */
@ApiTags('Venues')
@Controller('venues')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('INSTRUCTOR')
export class VenueController {
  constructor(private readonly venueService: VenueService) {}

  @Get()
  @ApiEndpoint(VenueDocs.list)
  async list(@Request() req: AuthenticatedRequest): Promise<Venue[]> {
    return this.venueService.list(req.user.id);
  }

  @Get(':id')
  @ApiEndpoint(VenueDocs.get)
  async get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Venue> {
    return this.venueService.get(req.user.id, id);
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint({ ...VenueDocs.create, body: CreateVenueDto })
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateVenueDto,
  ): Promise<Venue> {
    return this.venueService.create(req.user.id, dto);
  }

  @Patch(':id')
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  @ApiEndpoint({ ...VenueDocs.update, body: UpdateVenueDto })
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVenueDto,
  ): Promise<Venue> {
    return this.venueService.update(req.user.id, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint(VenueDocs.archive)
  async archive(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.venueService.archive(req.user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint(VenueDocs.remove)
  async remove(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.venueService.remove(req.user.id, id);
  }
}
