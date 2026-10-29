import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { ProfileService } from './profile.service';
import { CreateInstructorProfileDto } from './dto/create-instructor-profile.dto';
import { UpdateInstructorProfileDto } from './dto/update-instructor-profile.dto';
import { UpdateFullProfileDto } from './dto/update-full-profile.dto';
import { DiscoverInstructorsDto } from './dto/discover-instructors.dto';
import { SuggestedInstructorsDto } from './dto/suggested-instructors.dto';
import { UpdatePrivacySettingsDto } from './dto/update-privacy-settings.dto';
import { UpdateHandleDto } from './dto/update-handle.dto';
import {
  ProfileViewQueryDto,
  ProfileWorkoutPhotoQueryDto,
  ProfileWorkoutsQueryDto,
} from './dto/profile-view-query.dto';
import { sendPrivateImage } from '../workout/workout-photo.http';
import { ReportWorkoutDto } from '../workout/dto/report-workout.dto';
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
 * - GET    /profile/instructors/suggested → Coaches suggested to the caller
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

  /** Before `instructors/:id`, or its UUID pipe would reject "suggested". */
  @Get('instructors/suggested')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(ProfileDocs.suggestInstructors)
  async suggestInstructors(
    @Request() req: AuthenticatedRequest,
    @Query() dto: SuggestedInstructorsDto,
  ) {
    return this.profileService.suggestInstructors(req.user.id, dto);
  }

  @Get('instructors/by-handle/:handle')
  @ApiEndpoint(ProfileDocs.getInstructorPublicProfileByHandle)
  async getInstructorPublicProfileByHandle(@Param('handle') handle: string) {
    return this.profileService.getInstructorPublicProfileByHandle(handle);
  }

  /** The workouts this person made visible to the viewer; see the docs entry. */
  @Get('users/by-handle/:handle/workouts')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiEndpoint(ProfileDocs.getPublicUserWorkouts)
  async getPublicUserWorkouts(
    @Param('handle') handle: string,
    @Query() query: ProfileWorkoutsQueryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.profileService.getPublicUserWorkouts(
      handle,
      req.user?.id ?? null,
      query,
    );
  }

  /** One workout this person made visible to the viewer; see the docs entry. */
  @Get('users/by-handle/:handle/workouts/:workoutLogId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiEndpoint(ProfileDocs.getPublicUserWorkout)
  async getPublicUserWorkout(
    @Param('handle') handle: string,
    @Param('workoutLogId', ParseUUIDPipe) workoutLogId: string,
    @Query() query: ProfileViewQueryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.profileService.getPublicUserWorkout(
      handle,
      req.user?.id ?? null,
      workoutLogId,
      query.previewAs,
    );
  }

  /** That workout's photo, streamed; there is no public link to it. */
  @Get('users/by-handle/:handle/workouts/:workoutLogId/photo')
  @UseGuards(OptionalJwtAuthGuard)
  // Open to guests, and each one pulls the image through us from
  // Cloudinary: far more than a person scrolling a profile needs.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiEndpoint(ProfileDocs.getPublicUserWorkoutPhoto)
  async getPublicUserWorkoutPhoto(
    @Param('handle') handle: string,
    @Param('workoutLogId', ParseUUIDPipe) workoutLogId: string,
    @Query() query: ProfileWorkoutPhotoQueryDto,
    @Request() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    sendPrivateImage(
      res,
      await this.profileService.getPublicUserWorkoutPhoto(
        handle,
        req.user?.id ?? null,
        workoutLogId,
        query.previewAs,
      ),
    );
  }

  /** Report a workout this profile shows the caller; see the docs entry. */
  @Post('users/by-handle/:handle/workouts/:workoutLogId/report')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiEndpoint(ProfileDocs.reportUserWorkout)
  async reportUserWorkout(
    @Param('handle') handle: string,
    @Param('workoutLogId', ParseUUIDPipe) workoutLogId: string,
    @Body() dto: ReportWorkoutDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.profileService.reportUserWorkout(
      handle,
      req.user.id,
      workoutLogId,
      dto,
    );
  }

  /**
   * Public profile of ANY user (not only instructors), addressed by
   * handle. Uses `OptionalJwtAuthGuard` so anonymous viewers get the
   * `PUBLIC`-tier slice while authenticated viewers may see more
   * (owner sees everything; an active coach of the owner sees the
   * `COACHES_ONLY` slice). Audience resolution happens server-side.
   */
  @Get('users/by-handle/:handle')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiEndpoint(ProfileDocs.getPublicUserProfileByHandle)
  async getPublicUserProfileByHandle(
    @Param('handle') handle: string,
    @Query() query: ProfileViewQueryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.profileService.getPublicUserProfileByHandle(
      handle,
      req.user?.id ?? null,
      query.previewAs,
    );
  }

  @Get('instructors/:id')
  @ApiEndpoint(ProfileDocs.getInstructorPublicProfile)
  async getInstructorPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.profileService.getInstructorPublicProfile(id);
  }

  @Get('instructors/:id/groups')
  @ApiEndpoint(ProfileDocs.getInstructorPublicGroups)
  async getInstructorPublicGroups(@Param('id', ParseUUIDPipe) id: string) {
    return this.profileService.getInstructorPublicGroups(id);
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
  // PRIVACY & HANDLE (auth required)
  // =====================================================

  /**
   * Patch one or more fields in `user.privacy_settings`. The body is a
   * partial map keyed by `PrivacyControlledField`; values not present
   * are left untouched, so the FE can ship a one-field PATCH whenever
   * the user flips a single chooser.
   */
  @Patch('privacy')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({
    ...ProfileDocs.updatePrivacySettings,
    body: UpdatePrivacySettingsDto,
  })
  async updatePrivacySettings(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdatePrivacySettingsDto,
  ) {
    return this.profileService.updatePrivacySettings(req.user.id, dto);
  }

  /**
   * Claim/rename the user's handle (the vanity URL slug). 409 if
   * already taken (case-insensitive).
   */
  @Patch('handle')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({ ...ProfileDocs.updateHandle, body: UpdateHandleDto })
  async updateHandle(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateHandleDto,
  ) {
    return this.profileService.updateHandle(req.user.id, dto);
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
