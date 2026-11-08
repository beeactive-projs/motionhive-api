import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { OnboardingDocs } from '../../common/docs/onboarding.docs';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AnswerRoleDto } from './dto/answer-role.dto';
import { OnboardingStepsDto } from './dto/onboarding-steps.dto';
import { SetCoachCategoriesDto } from './dto/set-coach-categories.dto';
import { SetCoachDetailsDto } from './dto/set-coach-details.dto';
import { SetInterestsDto } from './dto/set-interests.dto';
import { SetLevelDto } from './dto/set-level.dto';
import type { OnboardingState } from './onboarding-state.service';
import { OnboardingService } from './onboarding.service';

/** A person answers each step by hand, a few times at most. */
const WRITE_THROTTLE = { default: { limit: 60, ttl: 3_600_000 } };

/**
 * The caller's welcome flow: what to ask, and the answers. Every write
 * returns the new state, so the app moves to the next step without a
 * second call.
 */
@ApiTags('Onboarding')
@Controller('users/me/onboarding')
@UseGuards(AuthGuard('jwt'))
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  @ApiEndpoint(OnboardingDocs.getState)
  async getState(
    @Request() req: AuthenticatedRequest,
  ): Promise<OnboardingState> {
    return this.onboardingService.getState(req.user.id);
  }

  @Put('role')
  @Throttle(WRITE_THROTTLE)
  @ApiEndpoint({ ...OnboardingDocs.answerRole, body: AnswerRoleDto })
  async answerRole(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AnswerRoleDto,
  ): Promise<OnboardingState> {
    return this.onboardingService.answerRole(req.user.id, dto);
  }

  @Put('interests')
  @Throttle(WRITE_THROTTLE)
  @ApiEndpoint({ ...OnboardingDocs.setInterests, body: SetInterestsDto })
  async setInterests(
    @Request() req: AuthenticatedRequest,
    @Body() dto: SetInterestsDto,
  ): Promise<OnboardingState> {
    return this.onboardingService.setInterests(req.user.id, dto);
  }

  @Put('level')
  @Throttle(WRITE_THROTTLE)
  @ApiEndpoint({ ...OnboardingDocs.setLevel, body: SetLevelDto })
  async setLevel(
    @Request() req: AuthenticatedRequest,
    @Body() dto: SetLevelDto,
  ): Promise<OnboardingState> {
    return this.onboardingService.setLevel(req.user.id, dto);
  }

  @Put('coach-categories')
  @Throttle(WRITE_THROTTLE)
  @ApiEndpoint({
    ...OnboardingDocs.setCoachCategories,
    body: SetCoachCategoriesDto,
  })
  async setCoachCategories(
    @Request() req: AuthenticatedRequest,
    @Body() dto: SetCoachCategoriesDto,
  ): Promise<OnboardingState> {
    return this.onboardingService.setCoachCategories(req.user.id, dto);
  }

  @Put('coach-details')
  @Throttle(WRITE_THROTTLE)
  @ApiEndpoint({ ...OnboardingDocs.setCoachDetails, body: SetCoachDetailsDto })
  async setCoachDetails(
    @Request() req: AuthenticatedRequest,
    @Body() dto: SetCoachDetailsDto,
  ): Promise<OnboardingState> {
    return this.onboardingService.setCoachDetails(req.user.id, dto);
  }

  @Post('skip')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @ApiEndpoint({ ...OnboardingDocs.skip, body: OnboardingStepsDto })
  async skip(
    @Request() req: AuthenticatedRequest,
    @Body() dto: OnboardingStepsDto,
  ): Promise<OnboardingState> {
    return this.onboardingService.skip(req.user.id, dto.steps);
  }

  @Post('dismiss')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @ApiEndpoint({ ...OnboardingDocs.dismiss, body: OnboardingStepsDto })
  async dismiss(
    @Request() req: AuthenticatedRequest,
    @Body() dto: OnboardingStepsDto,
  ): Promise<OnboardingState> {
    return this.onboardingService.dismiss(req.user.id, dto.steps);
  }
}
