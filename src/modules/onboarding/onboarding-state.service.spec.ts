import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';

import { makeModelMock } from '../../../test/helpers/sequelize-mocks';
import { CoachCategory } from './entities/coach-category.entity';
import {
  OnboardingRole,
  OnboardingStep,
  OnboardingStepStatus,
} from './entities/onboarding.enums';
import { UserInterest } from './entities/user-interest.entity';
import { UserOnboardingStep } from './entities/user-onboarding-step.entity';
import { OnboardingStateService } from './onboarding-state.service';

describe('OnboardingStateService', () => {
  const userId = 'user-1';
  const stepModel = makeModelMock();
  const userInterestModel = makeModelMock();
  const coachCategoryModel = makeModelMock();
  let service: OnboardingStateService;

  const steps = (status: OnboardingStepStatus, list: OnboardingStep[]) =>
    list.map((step) => ({ step, status }));

  beforeEach(async () => {
    jest.clearAllMocks();
    stepModel.findAll.mockResolvedValue([]);
    userInterestModel.findAll.mockResolvedValue([]);
    coachCategoryModel.findAll.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        OnboardingStateService,
        { provide: getModelToken(UserOnboardingStep), useValue: stepModel },
        { provide: getModelToken(UserInterest), useValue: userInterestModel },
        { provide: getModelToken(CoachCategory), useValue: coachCategoryModel },
      ],
    }).compile();
    service = moduleRef.get(OnboardingStateService);
  });

  it('asks someone new the whole trainee flow, with the level it was given', async () => {
    const state = await service.read({
      userId,
      isCoach: false,
      fitnessLevel: 'BEGINNER',
    });

    expect(state).toEqual({
      flowVersion: 1,
      role: null,
      steps: {
        ROLE: null,
        INTERESTS: null,
        LEVEL: null,
        COACH_CATEGORIES: null,
        COACH_DETAILS: null,
      },
      flow: [
        OnboardingStep.Role,
        OnboardingStep.Interests,
        OnboardingStep.Level,
      ],
      trainCard: [],
      coachCard: [],
      interestIds: [],
      fitnessLevel: 'BEGINNER',
      coachCategoryIds: [],
    });
  });

  it("reads only the person's own rows, answers in the order they were picked", async () => {
    userInterestModel.findAll.mockResolvedValue([
      { categoryId: 'cat-yoga' },
      { categoryId: 'cat-lose-fat' },
    ]);
    coachCategoryModel.findAll.mockResolvedValue([{ categoryId: 'cat-hiit' }]);

    const state = await service.read({
      userId,
      isCoach: true,
      fitnessLevel: null,
    });

    for (const model of [stepModel, userInterestModel, coachCategoryModel]) {
      expect(model.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId } }),
      );
    }
    expect(userInterestModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ order: [['createdAt', 'ASC']] }),
    );
    expect(state.interestIds).toEqual(['cat-yoga', 'cat-lose-fat']);
    expect(state.coachCategoryIds).toEqual(['cat-hiit']);
  });

  // The rows migration 083 gives every account that existed before the
  // flow: nothing is forced on them, the Home cards offer it instead.
  it('sends someone who had an account before the flow to Home, with the card', async () => {
    stepModel.findAll.mockResolvedValue(
      steps(OnboardingStepStatus.Skipped, [
        OnboardingStep.Role,
        OnboardingStep.Interests,
        OnboardingStep.Level,
      ]),
    );

    const state = await service.read({
      userId,
      isCoach: false,
      fitnessLevel: null,
    });

    expect(state.flow).toEqual([]);
    expect(state.trainCard).toEqual([
      OnboardingStep.Interests,
      OnboardingStep.Level,
    ]);
  });

  it('does the same for a coach who coached before the flow', async () => {
    stepModel.findAll.mockResolvedValue(
      steps(OnboardingStepStatus.Skipped, [
        OnboardingStep.CoachCategories,
        OnboardingStep.CoachDetails,
      ]),
    );

    const state = await service.read({
      userId,
      isCoach: true,
      fitnessLevel: null,
    });

    expect(state.role).toBe(OnboardingRole.Coach);
    expect(state.flow).toEqual([]);
    expect(state.coachCard).toEqual([
      OnboardingStep.CoachCategories,
      OnboardingStep.CoachDetails,
    ]);
  });
});
