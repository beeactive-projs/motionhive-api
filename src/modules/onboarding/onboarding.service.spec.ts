import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import {
  fakeTx,
  makeModelMock,
  makeSequelizeMock,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';
import { ProfileService } from '../profile/profile.service';
import { RoleService } from '../role/role.service';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { CategoryPicker, CategoryService } from './category.service';
import { Category } from './entities/category.entity';
import { CoachCategory } from './entities/coach-category.entity';
import {
  CategoryKind,
  OnboardingRole,
  OnboardingStep,
  OnboardingStepStatus,
} from './entities/onboarding.enums';
import { UserInterest } from './entities/user-interest.entity';
import { UserOnboardingStep } from './entities/user-onboarding-step.entity';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  const userId = 'user-1';

  const yoga = {
    name: 'Yoga',
    id: 'cat-yoga',
    kind: CategoryKind.Activity,
    coachesOnly: false,
  };
  const running = {
    name: 'Running',
    id: 'cat-running',
    kind: CategoryKind.Activity,
    coachesOnly: false,
  };
  const nutrition = {
    name: 'Nutrition',
    id: 'cat-nutrition',
    kind: CategoryKind.Activity,
    coachesOnly: true,
  };
  const loseFat = {
    name: 'Lose fat',
    id: 'cat-lose-fat',
    kind: CategoryKind.Goal,
    coachesOnly: false,
  };

  let service: OnboardingService;
  let categories: CategoryService;

  const categoryModel = makeModelMock();
  const userInterestModel = { ...makeModelMock(), bulkCreate: jest.fn() };
  const coachCategoryModel = { ...makeModelMock(), bulkCreate: jest.fn() };
  const stepModel = makeModelMock();
  const userModel = makeModelMock();
  const sequelize = makeSequelizeMock();

  const roleService = {
    getUserRoleNames: jest.fn(),
    assignRoleToUserByName: jest.fn(),
    invalidateUserRoleCache: jest.fn(),
  };
  const userService = { updateUser: jest.fn() };
  const profileService = {
    getInstructorProfile: jest.fn(),
    createInstructorProfileInTransaction: jest.fn(),
    updateInstructorProfile: jest.fn(),
  };

  /** A stored step row, with `save` so status changes can be seen. */
  const stepRow = (step: OnboardingStep, status: OnboardingStepStatus) => ({
    step,
    status,
    flowVersion: 1,
    save: jest.fn(),
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // The kind a picker reads decides the list it is checked against; a
    // read without one is the name lookup.
    categoryModel.findAll.mockImplementation(
      (options: { where?: { kind: CategoryKind } }) => {
        const all = [yoga, running, nutrition, loseFat];
        if (!options.where) {
          return Promise.resolve(
            all.map((category) => ({
              name: category.name,
              translations: null,
            })),
          );
        }
        const kind = options.where.kind;
        return Promise.resolve(
          all.filter((category) => category.kind === kind),
        );
      },
    );
    userModel.findByPk.mockResolvedValue({
      id: userId,
      firstName: 'Ana',
      lastName: 'Pop',
      fitnessLevel: null,
      save: jest.fn(),
    });
    roleService.getUserRoleNames.mockResolvedValue(['USER']);
    stepModel.findAll.mockResolvedValue([]);
    userInterestModel.findAll.mockResolvedValue([]);
    coachCategoryModel.findAll.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        OnboardingService,
        CategoryService,
        { provide: getModelToken(Category), useValue: categoryModel },
        { provide: getModelToken(UserInterest), useValue: userInterestModel },
        { provide: getModelToken(CoachCategory), useValue: coachCategoryModel },
        { provide: getModelToken(UserOnboardingStep), useValue: stepModel },
        { provide: getModelToken(User), useValue: userModel },
        { provide: Sequelize, useValue: sequelize },
        { provide: RoleService, useValue: roleService },
        { provide: UserService, useValue: userService },
        { provide: ProfileService, useValue: profileService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(OnboardingService);
    categories = moduleRef.get(CategoryService);
  });

  describe('getState', () => {
    it('sends the flow and the answers so far', async () => {
      stepModel.findAll.mockResolvedValue([
        { step: OnboardingStep.Role, status: OnboardingStepStatus.Done },
      ]);
      userInterestModel.findAll.mockResolvedValue([{ categoryId: yoga.id }]);

      const state = await service.getState(userId);

      expect(state.role).toBe(OnboardingRole.Train);
      expect(state.flow).toEqual([
        OnboardingStep.Interests,
        OnboardingStep.Level,
      ]);
      expect(state.interestIds).toEqual([yoga.id]);
      expect(state.flowVersion).toBe(1);
    });
  });

  describe('answerRole', () => {
    it('makes someone who picks COACH a coach, in the same transaction', async () => {
      profileService.getInstructorProfile.mockResolvedValue(null);

      await service.answerRole(userId, { role: OnboardingRole.Coach });

      expect(
        profileService.createInstructorProfileInTransaction,
      ).toHaveBeenCalledWith(userId, 'Ana', 'Pop', fakeTx);
      expect(stepModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          step: OnboardingStep.Role,
          status: OnboardingStepStatus.Done,
        }),
        { transaction: fakeTx },
      );
      expect(roleService.invalidateUserRoleCache).toHaveBeenCalledWith(userId);
    });

    it('only gives back the role when a coach profile was left behind', async () => {
      profileService.getInstructorProfile.mockResolvedValue({ id: 'p-1' });

      await service.answerRole(userId, { role: OnboardingRole.Coach });

      expect(
        profileService.createInstructorProfileInTransaction,
      ).not.toHaveBeenCalled();
      expect(roleService.assignRoleToUserByName).toHaveBeenCalledWith(
        userId,
        'INSTRUCTOR',
        undefined,
        undefined,
        fakeTx,
      );
    });

    it('changes nothing but the step for TRAIN, or for someone who coaches', async () => {
      await service.answerRole(userId, { role: OnboardingRole.Train });

      roleService.getUserRoleNames.mockResolvedValue(['USER', 'INSTRUCTOR']);
      await service.answerRole(userId, { role: OnboardingRole.Coach });

      expect(
        profileService.createInstructorProfileInTransaction,
      ).not.toHaveBeenCalled();
      expect(roleService.assignRoleToUserByName).not.toHaveBeenCalled();
    });
  });

  describe('setInterests', () => {
    it('swaps the activities only, then marks the step done', async () => {
      await service.setInterests(userId, { categoryIds: [running.id] });

      // Every activity is cleared; the goal is not among them.
      expect(userInterestModel.destroy).toHaveBeenCalledWith({
        where: {
          userId,
          categoryId: { [Op.in]: [yoga.id, running.id, nutrition.id] },
        },
        transaction: fakeTx,
      });
      expect(userInterestModel.bulkCreate).toHaveBeenCalledWith(
        [{ userId, categoryId: running.id }],
        { transaction: fakeTx },
      );
      expect(stepModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ step: OnboardingStep.Interests }),
        { transaction: fakeTx },
      );
    });

    it('refuses a coaches only category, a goal, or an unknown id', async () => {
      await expect(
        service.setInterests(userId, { categoryIds: [nutrition.id] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setInterests(userId, { categoryIds: [loseFat.id] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setInterests(userId, { categoryIds: ['nope'] }),
      ).rejects.toThrow(BadRequestException);
      expect(userInterestModel.bulkCreate).not.toHaveBeenCalled();
    });
  });

  describe('setLevel', () => {
    it('saves the level and swaps the goals', async () => {
      const user = {
        id: userId,
        fitnessLevel: null as string | null,
        save: jest.fn(),
      };
      userModel.findByPk.mockResolvedValue(user);

      await service.setLevel(userId, {
        fitnessLevel: 'BEGINNER',
        goalIds: [loseFat.id],
      });

      expect(user.fitnessLevel).toBe('BEGINNER');
      expect(user.save).toHaveBeenCalledWith({ transaction: fakeTx });
      expect(userInterestModel.bulkCreate).toHaveBeenCalledWith(
        [{ userId, categoryId: loseFat.id }],
        { transaction: fakeTx },
      );
    });
  });

  describe('setCoachCategories', () => {
    beforeEach(() => {
      roleService.getUserRoleNames.mockResolvedValue(['USER', 'INSTRUCTOR']);
    });

    it('is for coaches only', async () => {
      roleService.getUserRoleNames.mockResolvedValue(['USER']);

      await expect(
        service.setCoachCategories(userId, { categoryIds: [yoga.id] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('needs at least one category', async () => {
      await expect(
        service.setCoachCategories(userId, { categoryIds: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows coaches only ones and adds new words without duplicates', async () => {
      profileService.getInstructorProfile.mockResolvedValue({
        specializations: ['Forță'],
      });

      await service.setCoachCategories(userId, {
        categoryIds: [yoga.id, nutrition.id],
        otherSpecializations: ['forta', ' Kettlebells ', ''],
      });

      expect(coachCategoryModel.bulkCreate).toHaveBeenCalledWith(
        [
          { userId, categoryId: yoga.id },
          { userId, categoryId: nutrition.id },
        ],
        { transaction: fakeTx },
      );
      expect(profileService.updateInstructorProfile).toHaveBeenCalledWith(
        userId,
        { specializations: ['Forță', 'Kettlebells'] },
        fakeTx,
      );
    });

    it('leaves a word that only names a category to the category', async () => {
      profileService.getInstructorProfile.mockResolvedValue({
        specializations: [],
      });
      categoryModel.findAll.mockResolvedValueOnce([yoga]);
      categoryModel.findAll.mockResolvedValueOnce([
        { name: 'Yoga', translations: null },
        {
          name: 'Strength training',
          translations: { ro: { name: 'Antrenament de forță' } },
        },
      ]);

      await service.setCoachCategories(userId, {
        categoryIds: [yoga.id],
        otherSpecializations: ['yoga', 'antrenament de forta', 'Kettlebells'],
      });

      expect(profileService.updateInstructorProfile).toHaveBeenCalledWith(
        userId,
        { specializations: ['Kettlebells'] },
        fakeTx,
      );
    });

    it('leaves the specializations alone when nothing new was given', async () => {
      profileService.getInstructorProfile.mockResolvedValue({
        specializations: ['Yoga'],
      });

      await service.setCoachCategories(userId, {
        categoryIds: [yoga.id],
        otherSpecializations: ['yoga'],
      });

      expect(profileService.updateInstructorProfile).not.toHaveBeenCalled();
    });
  });

  describe('setCoachDetails', () => {
    it('saves only the fields sent, each where it lives', async () => {
      roleService.getUserRoleNames.mockResolvedValue(['USER', 'INSTRUCTOR']);

      await service.setCoachDetails(userId, {
        city: ' Cluj-Napoca ',
        isAcceptingClients: false,
      });

      expect(userService.updateUser).toHaveBeenCalledWith(
        userId,
        { city: 'Cluj-Napoca' },
        fakeTx,
      );
      expect(profileService.updateInstructorProfile).toHaveBeenCalledWith(
        userId,
        { isAcceptingClients: false },
        fakeTx,
      );
    });
  });

  describe('skip and dismiss', () => {
    it('never turns an answered step into a skipped one', async () => {
      const done = stepRow(OnboardingStep.Interests, OnboardingStepStatus.Done);
      stepModel.findAll.mockResolvedValueOnce([done]);

      await service.skip(userId, [
        OnboardingStep.Interests,
        OnboardingStep.Level,
      ]);

      expect(done.save).not.toHaveBeenCalled();
      expect(stepModel.create).toHaveBeenCalledTimes(1);
      expect(stepModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          step: OnboardingStep.Level,
          status: OnboardingStepStatus.Skipped,
        }),
        { transaction: fakeTx },
      );
    });

    it('dismisses a skipped step for good, and an answer still wins later', async () => {
      const skipped = stepRow(
        OnboardingStep.Level,
        OnboardingStepStatus.Skipped,
      );
      stepModel.findAll.mockResolvedValueOnce([skipped]);

      await service.dismiss(userId, [OnboardingStep.Level]);

      expect(skipped.status).toBe(OnboardingStepStatus.Dismissed);
      expect(skipped.save).toHaveBeenCalledWith({ transaction: fakeTx });

      stepModel.findAll.mockResolvedValueOnce([skipped]);
      await service.setLevel(userId, { fitnessLevel: null, goalIds: [] });

      expect(skipped.status).toBe(OnboardingStepStatus.Done);
    });
  });

  describe('CategoryService.assertPickable', () => {
    it('hands back the ids of the kind being replaced', async () => {
      const { kindIds } = await categories.assertPickable(
        CategoryPicker.Goals,
        [loseFat.id],
      );
      expect(kindIds).toEqual([loseFat.id]);
    });
  });
});
