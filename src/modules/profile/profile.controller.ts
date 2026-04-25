import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { ProfileService } from './profile.service';
import { CreateInstructorProfileDto } from './dto/create-instructor-profile.dto';
import { UpdateInstructorProfileDto } from './dto/update-instructor-profile.dto';
import { UpdateFullProfileDto } from './dto/update-full-profile.dto';
import { DiscoverInstructorsDto } from './dto/discover-instructors.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { ProfileDocs } from '../../common/docs/profile.docs';

/**
 * Profile Controller
 *
 * Manages user profiles:
 *
 * Public (no auth):
 * - GET    /profile/instructors/discover → Browse/search public instructors
 *
 * Authenticated:
 * - GET    /profile/me              → Full profile overview (roles + instructor profile)
 * - PATCH  /profile/me              → Unified profile update (account + instructor)
 * - POST   /profile/instructor      → Activate instructor profile ("I want to instruct")
 * - GET    /profile/instructor      → Get instructor profile
 * - PATCH  /profile/instructor      → Update instructor profile
 */
@ApiTags('Profiles')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  // =====================================================
  // INSTRUCTOR DISCOVERY (public — no auth required)
  // =====================================================

  @Get('instructors/discover')
  @ApiEndpoint(ProfileDocs.discoverTrainers)
  async discoverInstructors(@Query() dto: DiscoverInstructorsDto) {
    return this.profileService.discoverInstructors(dto);
  }

  @Get('instructors/:id')
  @ApiEndpoint(ProfileDocs.getInstructorPublicProfile)
  async getInstructorPublicProfile(@Param('id') id: string) {
    return this.profileService.getInstructorPublicProfile(id);
  }

  // =====================================================
  // PROFILE OVERVIEW (auth required)
  // =====================================================

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ProfileDocs.getProfileOverview)
  async getProfileOverview(@Request() req: AuthenticatedRequest) {
    return this.profileService.getProfileOverview(req.user);
  }

  /**
   * Unified profile update
   *
   * Update user + user profile + instructor profiles in a single API call.
   * Only provided sections are updated.
   */
  @Patch('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({
    ...ProfileDocs.updateFullProfile,
    body: UpdateFullProfileDto,
  })
  async updateFullProfile(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateFullProfileDto,
  ) {
    return this.profileService.updateFullProfile(req.user.id, dto);
  }

  // =====================================================
  // INSTRUCTOR PROFILE
  // =====================================================

  @Post('instructor')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({
    ...ProfileDocs.createOrganizerProfile,
    body: CreateInstructorProfileDto,
  })
  async createInstructorProfile(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateInstructorProfileDto,
  ) {
    return this.profileService.createInstructorProfile(req.user.id, dto);
  }

  @Get('instructor')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ProfileDocs.getOrganizerProfile)
  async getInstructorProfile(@Request() req: AuthenticatedRequest) {
    return this.profileService.getInstructorProfile(req.user.id);
  }

  @Patch('instructor')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({
    ...ProfileDocs.updateOrganizerProfile,
    body: UpdateInstructorProfileDto,
  })
  async updateInstructorProfile(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateInstructorProfileDto,
  ) {
    return this.profileService.updateInstructorProfile(req.user.id, dto);
  }
}
