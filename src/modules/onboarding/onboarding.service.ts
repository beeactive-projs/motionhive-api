import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { apiError } from '../../common/i18n';
import type { ExerciseLevel } from '../exercise/entities/exercise.enums';
import { ProfileService } from '../profile/profile.service';
import { RoleService } from '../role/role.service';
import type { UpdateUserDto } from '../user/dto/update-user.dto';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { CategoryPicker, CategoryService, foldWord } from './category.service';
import type { AnswerRoleDto } from './dto/answer-role.dto';
import type { SetCoachCategoriesDto } from './dto/set-coach-categories.dto';
import type { SetCoachDetailsDto } from './dto/set-coach-details.dto';
import type { SetInterestsDto } from './dto/set-interests.dto';
import type { SetLevelDto } from './dto/set-level.dto';
import { CoachCategory } from './entities/coach-category.entity';
import {
  OnboardingRole,
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

/** What `GET /users/me/onboarding` sends: the flow plus the answers so far. */
export interface OnboardingState extends OnboardingFlow {
  flowVersion: number;
  /** Category ids the person likes (activities and goals). */
  interestIds: string[];
  fitnessLevel: ExerciseLevel | null;
  /** Category ids a coach coaches; empty for someone who does not. */
  coachCategoryIds: string[];
}

/**
 * The welcome flow a person sees after they first sign in, and the answers
 * it saves: their role, what they like, their level and goals, and (for a
 * coach) what they coach and where. Each answer marks its step DONE, so the
 * apps never ask it again; skipping and closing are saved too (see
 * `computeOnboardingFlow` for what is asked when).
 *
 * The same writes serve the Account screens later, so editing interests
 * there is the same call.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @InjectModel(UserInterest)
    private readonly userInterestModel: typeof UserInterest,
    @InjectModel(CoachCategory)
    private readonly coachCategoryModel: typeof CoachCategory,
    @InjectModel(UserOnboardingStep)
    private readonly stepModel: typeof UserOnboardingStep,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly categoryService: CategoryService,
    private readonly roleService: RoleService,
    private readonly userService: UserService,
    private readonly profileService: ProfileService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /** Where the person is in the flow, and what they answered so far. */
  async getState(userId: string): Promise<OnboardingState> {
    const [user, roleNames, steps, interests, coachCategories] =
      await Promise.all([
        this.userModel.findByPk(userId, { attributes: ['id', 'fitnessLevel'] }),
        this.roleService.getUserRoleNames(userId),
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

    if (!user) {
      throw new NotFoundException(apiError('user.notFound'));
    }

    const statuses: Partial<Record<OnboardingStep, OnboardingStepStatus>> = {};
    for (const row of steps) {
      statuses[row.step] = row.status;
    }

    const flow = computeOnboardingFlow({
      isCoach: roleNames.includes('INSTRUCTOR'),
      statuses,
    });

    return {
      flowVersion: ONBOARDING_FLOW_VERSION,
      ...flow,
      interestIds: interests.map((row) => row.categoryId),
      fitnessLevel: user.fitnessLevel,
      coachCategoryIds: coachCategories.map((row) => row.categoryId),
    };
  }

  /**
   * "How will you use MotionHive?". COACH makes them a coach (profile and
   * role, as "Become a coach" does); TRAIN changes nothing but the step.
   * Someone who already coaches stays a coach either way.
   */
  async answerRole(
    userId: string,
    dto: AnswerRoleDto,
  ): Promise<OnboardingState> {
    const roleNames = await this.roleService.getUserRoleNames(userId);
    const becomesCoach =
      dto.role === OnboardingRole.Coach && !roleNames.includes('INSTRUCTOR');

    await this.sequelize.transaction(async (tx) => {
      if (becomesCoach) {
        await this.makeCoach(userId, tx);
      }
      await this.markSteps(
        userId,
        [OnboardingStep.Role],
        OnboardingStepStatus.Done,
        tx,
      );
    });

    if (becomesCoach) {
      // The role write cleared the cache inside the transaction; a request
      // in between could have cached the old roles again.
      this.roleService.invalidateUserRoleCache(userId);
      this.logger.log(
        `User ${userId} became a coach from the welcome flow`,
        'OnboardingService',
      );
    }

    return this.getState(userId);
  }

  /**
   * The activities a person likes, replacing the ones they had. Goals are
   * left alone (they are the level step's).
   */
  async setInterests(
    userId: string,
    dto: SetInterestsDto,
  ): Promise<OnboardingState> {
    const { kindIds } = await this.categoryService.assertPickable(
      CategoryPicker.Interests,
      dto.categoryIds,
    );

    await this.sequelize.transaction(async (tx) => {
      await this.replaceInterests(userId, kindIds, dto.categoryIds, tx);
      await this.markSteps(
        userId,
        [OnboardingStep.Interests],
        OnboardingStepStatus.Done,
        tx,
      );
    });

    return this.getState(userId);
  }

  /**
   * How far along a person is and why they train. Replaces their goals;
   * activities are left alone.
   */
  async setLevel(userId: string, dto: SetLevelDto): Promise<OnboardingState> {
    const { kindIds } = await this.categoryService.assertPickable(
      CategoryPicker.Goals,
      dto.goalIds,
    );

    await this.sequelize.transaction(async (tx) => {
      const user = await this.userModel.findByPk(userId, { transaction: tx });
      if (!user) {
        throw new NotFoundException(apiError('user.notFound'));
      }
      user.fitnessLevel = dto.fitnessLevel ?? null;
      await user.save({ transaction: tx });

      await this.replaceInterests(userId, kindIds, dto.goalIds, tx);
      await this.markSteps(
        userId,
        [OnboardingStep.Level],
        OnboardingStepStatus.Done,
        tx,
      );
    });

    return this.getState(userId);
  }

  /**
   * What a coach coaches, replacing what they had. Their own words for
   * what the list misses are added to the profile's specializations, never
   * replacing what is there.
   */
  async setCoachCategories(
    userId: string,
    dto: SetCoachCategoriesDto,
  ): Promise<OnboardingState> {
    await this.assertCoach(userId);
    if (dto.categoryIds.length === 0) {
      throw new BadRequestException(
        apiError('onboarding.coachCategoryRequired'),
      );
    }
    await this.categoryService.assertPickable(
      CategoryPicker.Coach,
      dto.categoryIds,
    );

    const specializations = await this.mergedSpecializations(
      userId,
      dto.otherSpecializations ?? [],
    );

    await this.sequelize.transaction(async (tx) => {
      await this.coachCategoryModel.destroy({
        where: { userId },
        transaction: tx,
      });
      await this.coachCategoryModel.bulkCreate(
        dto.categoryIds.map((categoryId) => ({ userId, categoryId })),
        { transaction: tx },
      );

      if (specializations) {
        await this.profileService.updateInstructorProfile(
          userId,
          { specializations },
          tx,
        );
      }

      await this.markSteps(
        userId,
        [OnboardingStep.CoachCategories],
        OnboardingStepStatus.Done,
        tx,
      );
    });

    return this.getState(userId);
  }

  /**
   * Where a coach works and whether they take new clients. Only the fields
   * sent are saved; a country change is refused once they have a payout
   * account (UserService.updateUser).
   */
  async setCoachDetails(
    userId: string,
    dto: SetCoachDetailsDto,
  ): Promise<OnboardingState> {
    await this.assertCoach(userId);

    const account: UpdateUserDto = {};
    if (dto.city !== undefined) {
      account.city = dto.city.trim();
    }
    if (dto.countryCode !== undefined) {
      account.countryCode = dto.countryCode;
    }

    await this.sequelize.transaction(async (tx) => {
      if (Object.keys(account).length > 0) {
        await this.userService.updateUser(userId, account, tx);
      }
      if (dto.isAcceptingClients !== undefined) {
        await this.profileService.updateInstructorProfile(
          userId,
          { isAcceptingClients: dto.isAcceptingClients },
          tx,
        );
      }
      await this.markSteps(
        userId,
        [OnboardingStep.CoachDetails],
        OnboardingStepStatus.Done,
        tx,
      );
    });

    return this.getState(userId);
  }

  /**
   * Steps passed over ("Skip", or closing the flow). They leave the flow and
   * wait on a Home card. A step already answered or dismissed stays so.
   */
  async skip(
    userId: string,
    steps: OnboardingStep[],
  ): Promise<OnboardingState> {
    await this.sequelize.transaction(async (tx) => {
      await this.markSteps(userId, steps, OnboardingStepStatus.Skipped, tx);
    });
    return this.getState(userId);
  }

  /**
   * Steps whose Home card was closed: never offered again. An answered
   * step stays answered.
   */
  async dismiss(
    userId: string,
    steps: OnboardingStep[],
  ): Promise<OnboardingState> {
    await this.sequelize.transaction(async (tx) => {
      await this.markSteps(userId, steps, OnboardingStepStatus.Dismissed, tx);
    });
    return this.getState(userId);
  }

  /**
   * Records what became of these steps. DONE always wins (answering from
   * Account after closing a card counts). DISMISSED replaces a skip but
   * never an answer, and SKIPPED only fills a step nothing happened to.
   */
  private async markSteps(
    userId: string,
    steps: OnboardingStep[],
    status: OnboardingStepStatus,
    tx: Transaction,
  ): Promise<void> {
    const existing = await this.stepModel.findAll({
      where: { userId, step: { [Op.in]: steps } },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    const byStep = new Map(existing.map((row) => [row.step, row]));

    for (const step of steps) {
      const row = byStep.get(step);
      if (!row) {
        await this.stepModel.create(
          { userId, step, status, flowVersion: ONBOARDING_FLOW_VERSION },
          { transaction: tx },
        );
        continue;
      }
      if (!this.replaces(status, row.status)) {
        continue;
      }
      row.status = status;
      row.flowVersion = ONBOARDING_FLOW_VERSION;
      await row.save({ transaction: tx });
    }
  }

  /** Whether a new status may overwrite the one a step already has. */
  private replaces(
    next: OnboardingStepStatus,
    current: OnboardingStepStatus,
  ): boolean {
    if (next === current) {
      return false;
    }
    if (next === OnboardingStepStatus.Done) {
      return true;
    }
    if (next === OnboardingStepStatus.Dismissed) {
      return current === OnboardingStepStatus.Skipped;
    }
    return false;
  }

  /** Swaps one kind of a person's interests (activities or goals) for `ids`. */
  private async replaceInterests(
    userId: string,
    kindIds: string[],
    ids: string[],
    tx: Transaction,
  ): Promise<void> {
    if (kindIds.length > 0) {
      await this.userInterestModel.destroy({
        where: { userId, categoryId: { [Op.in]: kindIds } },
        transaction: tx,
      });
    }
    if (ids.length > 0) {
      await this.userInterestModel.bulkCreate(
        ids.map((categoryId) => ({ userId, categoryId })),
        { transaction: tx },
      );
    }
  }

  /** A coach profile and the INSTRUCTOR role, or just the role when a profile is left over. */
  private async makeCoach(userId: string, tx: Transaction): Promise<void> {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id', 'firstName', 'lastName'],
      transaction: tx,
    });
    if (!user) {
      throw new NotFoundException(apiError('user.notFound'));
    }

    // An admin can revoke the role and leave the profile behind.
    const profile = await this.profileService.getInstructorProfile(userId);
    if (profile) {
      await this.roleService.assignRoleToUserByName(
        userId,
        'INSTRUCTOR',
        undefined,
        undefined,
        tx,
      );
      return;
    }

    await this.profileService.createInstructorProfileInTransaction(
      userId,
      user.firstName,
      user.lastName,
      tx,
    );
  }

  /** @throws ForbiddenException when the person does not coach */
  private async assertCoach(userId: string): Promise<void> {
    const roleNames = await this.roleService.getUserRoleNames(userId);
    if (!roleNames.includes('INSTRUCTOR')) {
      throw new ForbiddenException(apiError('onboarding.coachRequired'));
    }
  }

  /**
   * The profile's specializations with the coach's new words added, or null
   * when nothing new was given. Compared blind to case and accents, so
   * "forta" next to "Forță" is not added twice, and a word that only names
   * a category ("yoga") is left to the category.
   */
  private async mergedSpecializations(
    userId: string,
    words: string[],
  ): Promise<string[] | null> {
    if (words.length === 0) {
      return null;
    }
    const [profile, categoryNames] = await Promise.all([
      this.profileService.getInstructorProfile(userId),
      this.categoryService.foldedNames(),
    ]);
    const merged: string[] = [];
    if (profile && Array.isArray(profile.specializations)) {
      merged.push(...profile.specializations);
    }

    const seen = new Set(merged.map((word) => foldWord(word)));
    let added = false;
    for (const raw of words) {
      const word = raw.trim();
      const key = foldWord(word);
      if (word === '' || seen.has(key) || categoryNames.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(word);
      added = true;
    }

    if (!added) {
      return null;
    }
    return merged;
  }
}
