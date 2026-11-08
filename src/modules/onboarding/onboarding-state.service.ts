import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import type { ExerciseLevel } from '../exercise/entities/exercise.enums';
import { CoachCategory } from './entities/coach-category.entity';
import {
  OnboardingStep,
  OnboardingStepStatus,
} from './entities/onboarding.enums';
import { UserInterest } from './entities/user-interest.entity';
import { UserOnboardingStep } from './entities/user-onboarding-step.entity';
import {
  computeOnboardingFlow,
  ONBOARDING_FLOW_VERSION,
  type OnboardingFlow,
} from './onboarding-flow';

/**
 * What `GET /users/me/onboarding` sends, and `onboarding` on `GET /users/me`:
 * the flow plus the answers so far.
 */
export interface OnboardingState extends OnboardingFlow {
  flowVersion: number;
  /** Category ids the person likes (activities and goals). */
  interestIds: string[];
  fitnessLevel: ExerciseLevel | null;
  /** Category ids a coach coaches; empty for someone who does not. */
  coachCategoryIds: string[];
}

/** The person the state is read for, as the caller already has them. */
export interface OnboardingStateInput {
  userId: string;
  /** Holds the INSTRUCTOR role. */
  isCoach: boolean;
  fitnessLevel: ExerciseLevel | null;
}

/**
 * Reads where a person is in the welcome flow. The one implementation
 * behind `GET /users/me/onboarding` (OnboardingService) and the profile the
 * apps load on start (`GET /users/me`). The caller passes the role and level
 * it already holds (`req.user` carries both), so this needs no RoleService
 * or user lookup and its module imports nothing but its three tables.
 */
@Injectable()
export class OnboardingStateService {
  constructor(
    @InjectModel(UserOnboardingStep)
    private readonly stepModel: typeof UserOnboardingStep,
    @InjectModel(UserInterest)
    private readonly userInterestModel: typeof UserInterest,
    @InjectModel(CoachCategory)
    private readonly coachCategoryModel: typeof CoachCategory,
  ) {}

  /** Where the person is in the flow, and what they answered so far. */
  async read(input: OnboardingStateInput): Promise<OnboardingState> {
    const { userId } = input;
    const [steps, interests, coachCategories] = await Promise.all([
      this.stepModel.findAll({
        where: { userId },
        attributes: ['step', 'status'],
      }),
      this.userInterestModel.findAll({
        where: { userId },
        attributes: ['categoryId'],
        order: [['createdAt', 'ASC']],
      }),
      this.coachCategoryModel.findAll({
        where: { userId },
        attributes: ['categoryId'],
        order: [['createdAt', 'ASC']],
      }),
    ]);

    const statuses: Partial<Record<OnboardingStep, OnboardingStepStatus>> = {};
    for (const row of steps) {
      statuses[row.step] = row.status;
    }

    const flow = computeOnboardingFlow({ isCoach: input.isCoach, statuses });

    return {
      flowVersion: ONBOARDING_FLOW_VERSION,
      ...flow,
      interestIds: interests.map((row) => row.categoryId),
      fitnessLevel: input.fitnessLevel,
      coachCategoryIds: coachCategories.map((row) => row.categoryId),
    };
  }
}
