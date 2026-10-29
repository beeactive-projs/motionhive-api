import { ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { InstructorProfile } from './entities/instructor-profile.entity';
import { ProfileService, isFieldVisible } from './profile.service';
import { RoleService } from '../role/role.service';
import { UserService } from '../user/user.service';
import { SearchIndexService } from '../search/search-index.service';
import { ReviewService } from '../review/review.service';
import { GroupService } from '../group/group.service';
import { VenueService } from '../venue/venue.service';
import { WorkoutLogService } from '../workout/workout-log.service';
import { WorkoutReportService } from '../workout/workout-report.service';
import { WorkoutPhotoService } from '../workout/workout-photo.service';
import { MessageReportCategory } from '../messaging/entities/message-report.entity';
import { User } from '../user/entities/user.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Smoke tests for ProfileService — covers the surface the FE relies on:
 *   - constructor wires up cleanly
 *   - getInstructorPublicProfile / by-handle: 404 on miss, happy path,
 *     public-safe venue projection
 *   - updateInstructorProfile: 404 when no row, happy path reindexes
 *   - discoverInstructors: returns the FE-shaped projection
 *   - updateHandle: 409 on collision
 *   - updatePrivacySettings: merges patch, doesn't drop existing keys
 *   - getPublicUserProfileByHandle: 404 paths + audience resolution
 *   - isFieldVisible matrix (pure helper)
 */
describe('ProfileService (smoke — not exhaustive)', () => {
  const me = 'me-user-id';
  const stranger = 'someone-else';

  let service: ProfileService;

  // ── Injected mocks ───────────────────────────────────────────────
  const instructorProfileModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
  };

  const sequelize = {
    transaction: jest.fn((cb: (tx: typeof fakeTx) => unknown) =>
      Promise.resolve(cb(fakeTx)),
    ),
    where: jest.fn(),
    fn: jest.fn(),
    col: jest.fn(),
    escape: jest.fn((v: string) => `'${v}'`),
  };

  const workoutReportService = {
    submit: jest.fn().mockResolvedValue({ id: 'r-1', status: 'OPEN' }),
  };
  const workoutPhotoService = {
    photoForProfile: jest.fn().mockResolvedValue(Buffer.from('jpeg')),
  };
  const workoutLogService = {
    countForProfile: jest.fn().mockResolvedValue(0),
    findForProfile: jest.fn(),
    listForProfile: jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    }),
  };
  const roleService = {
    assignRoleToUserByName: jest.fn(),
    getUserRoles: jest.fn(),
  };

  const userService = {
    updateUser: jest.fn(),
  };

  const searchIndexService = {
    upsertInstructor: jest.fn(),
  };

  const reviewService = {
    getSummaryForProfile: jest.fn(),
  };

  const groupService = {
    listPublicGroupsForInstructor: jest.fn(),
    sharedGroups: jest.fn(),
  };

  const venueService = {
    listPublicForProfile: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    // Most tests don't care about venues; opt in per-test with mockResolvedValueOnce.
    venueService.listPublicForProfile.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: getModelToken(InstructorProfile),
          useValue: instructorProfileModel,
        },
        { provide: Sequelize, useValue: sequelize },
        { provide: RoleService, useValue: roleService },
        { provide: UserService, useValue: userService },
        { provide: SearchIndexService, useValue: searchIndexService },
        { provide: ReviewService, useValue: reviewService },
        { provide: GroupService, useValue: groupService },
        { provide: VenueService, useValue: venueService },
        { provide: WorkoutLogService, useValue: workoutLogService },
        { provide: WorkoutReportService, useValue: workoutReportService },
        { provide: WorkoutPhotoService, useValue: workoutPhotoService },
        {
          provide: WINSTON_MODULE_NEST_PROVIDER,
          useValue: makeSilentLogger(),
        },
      ],
    }).compile();
    service = module.get(ProfileService);
  });

  // ───── constructor wiring ─────────────────────────────────────────

  it('wires up the service', () => {
    expect(service).toBeDefined();
  });

  // ───── isFieldVisible (pure matrix) ───────────────────────────────

  describe('isFieldVisible', () => {
    it('OWNER always sees everything', () => {
      expect(isFieldVisible('ONLY_ME', 'OWNER')).toBe(true);
      expect(isFieldVisible('COACHES_ONLY', 'OWNER')).toBe(true);
      expect(isFieldVisible('PUBLIC', 'OWNER')).toBe(true);
    });

    it('COACH sees everything except ONLY_ME', () => {
      expect(isFieldVisible('ONLY_ME', 'COACH')).toBe(false);
      expect(isFieldVisible('COACHES_ONLY', 'COACH')).toBe(true);
      expect(isFieldVisible('PUBLIC', 'COACH')).toBe(true);
    });

    it('PUBLIC only sees PUBLIC fields', () => {
      expect(isFieldVisible('ONLY_ME', 'PUBLIC')).toBe(false);
      expect(isFieldVisible('COACHES_ONLY', 'PUBLIC')).toBe(false);
      expect(isFieldVisible('PUBLIC', 'PUBLIC')).toBe(true);
    });
  });

  // ───── updateInstructorProfile ────────────────────────────────────

  describe('updateInstructorProfile', () => {
    it('404s when the user has no instructor profile row', async () => {
      instructorProfileModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updateInstructorProfile(me, { bio: 'hi' }),
      ).rejects.toThrow(NotFoundException);
      expect(searchIndexService.upsertInstructor).not.toHaveBeenCalled();
    });

    it('updates the row and reindexes the search doc', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      instructorProfileModel.findOne.mockResolvedValueOnce({
        id: 'ip-1',
        userId: me,
        update,
      });

      const out = await service.updateInstructorProfile(me, {
        bio: 'New bio',
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ bio: 'New bio' }),
        expect.anything(),
      );
      expect(searchIndexService.upsertInstructor).toHaveBeenCalledWith(
        me,
        undefined,
      );
      expect(out.id).toBe('ip-1');
    });
  });

  // ───── getInstructorPublicProfile / by user id ────────────────────

  describe('getInstructorPublicProfile', () => {
    it('404s when no instructor profile exists for the user', async () => {
      instructorProfileModel.findOne.mockResolvedValueOnce(null);
      await expect(service.getInstructorPublicProfile('u-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the public DTO with rating summary on the happy path', async () => {
      instructorProfileModel.findOne.mockResolvedValueOnce({
        id: 'ip-1',
        userId: 'u-1',
        displayName: 'Coach J',
        bio: 'hello',
        specializations: ['yoga'],
        certifications: [],
        yearsOfExperience: 5,
        isAcceptingClients: true,
        isPublic: true,
        socialLinks: { instagram: 'https://insta/x' },
        showSocialLinks: true,
        showEmail: true,
        showPhone: false,
        createdAt: new Date('2024-01-01'),
        user: {
          handle: 'coach-j',
          firstName: 'Jane',
          lastName: 'Doe',
          avatarId: 1,
          avatarUrl: null,
          email: 'jane@example.com',
          phone: '+40700000000',
          city: 'Bucharest',
          countryCode: 'RO',
          language: 'en',
          timezone: 'Europe/Bucharest',
          createdAt: new Date('2024-01-01'),
          privacySettings: {},
        },
      });
      reviewService.getSummaryForProfile.mockResolvedValueOnce({
        total: 3,
        average: 4.5,
      });

      const out = await service.getInstructorPublicProfile('u-1');

      expect(reviewService.getSummaryForProfile).toHaveBeenCalledWith('ip-1');
      // Default privacy: email + phone are ONLY_ME for public → masked
      expect(out.email).toBeNull();
      expect(out.phone).toBeNull();
      // Defaults: firstName + city are PUBLIC → surfaced
      expect(out.firstName).toBe('Jane');
      expect(out.city).toBe('Bucharest');
      // Defaults: language + timezone are COACHES_ONLY → masked for PUBLIC
      expect(out.language).toBeNull();
      expect(out.timezone).toBeNull();
      expect(out.rating).toEqual({ total: 3, average: 4.5 });
      expect(out.handle).toBe('coach-j');
    });

    it('returns rating = null when there are no reviews', async () => {
      instructorProfileModel.findOne.mockResolvedValueOnce({
        id: 'ip-2',
        userId: 'u-2',
        displayName: null,
        bio: null,
        specializations: [],
        certifications: [],
        yearsOfExperience: null,
        isAcceptingClients: true,
        isPublic: true,
        socialLinks: {},
        showSocialLinks: true,
        showEmail: true,
        showPhone: false,
        createdAt: new Date(),
        user: {
          handle: 'q',
          firstName: 'Q',
          lastName: 'R',
          avatarId: 1,
          avatarUrl: null,
          email: 'q@x',
          phone: null,
          city: null,
          countryCode: null,
          language: null,
          timezone: null,
          createdAt: new Date(),
          privacySettings: {},
        },
      });
      reviewService.getSummaryForProfile.mockResolvedValueOnce({
        total: 0,
        average: 0,
      });

      const out = await service.getInstructorPublicProfile('u-2');
      expect(out.rating).toBeNull();
    });

    it('projects venues down to public-safe fields only', async () => {
      instructorProfileModel.findOne.mockResolvedValueOnce({
        id: 'ip-3',
        userId: 'u-3',
        specializations: [],
        certifications: [],
        socialLinks: {},
        createdAt: new Date(),
        user: { handle: 'v', privacySettings: {}, createdAt: new Date() },
      });
      reviewService.getSummaryForProfile.mockResolvedValueOnce({
        total: 0,
        average: 0,
      });
      venueService.listPublicForProfile.mockResolvedValueOnce([
        {
          id: 'v-1',
          kind: 'GYM',
          isOnline: false,
          name: 'Downtown Gym',
          city: 'Bucharest',
          region: 'B',
          countryCode: 'RO',
          addressLine1: '12 Secret St',
          meetingUrl: 'https://meet.example/private',
          instructorId: 'ip-3',
        },
      ]);

      const out = await service.getInstructorPublicProfile('u-3');

      expect(venueService.listPublicForProfile).toHaveBeenCalledWith('ip-3');
      expect(out.venues).toEqual([
        {
          id: 'v-1',
          kind: 'GYM',
          isOnline: false,
          name: 'Downtown Gym',
          city: 'Bucharest',
          region: 'B',
          countryCode: 'RO',
        },
      ]);
    });
  });

  // ───── getInstructorPublicProfileByHandle ─────────────────────────

  describe('getInstructorPublicProfileByHandle', () => {
    it('404s on an empty handle (no DB hit)', async () => {
      await expect(
        service.getInstructorPublicProfileByHandle('   '),
      ).rejects.toThrow(NotFoundException);
      expect(instructorProfileModel.findOne).not.toHaveBeenCalled();
    });

    it('404s when the handle does not match an instructor', async () => {
      instructorProfileModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.getInstructorPublicProfileByHandle('ghost'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ───── discoverInstructors ────────────────────────────────────────

  describe('discoverInstructors', () => {
    it('returns the FE-shaped projection for each row', async () => {
      instructorProfileModel.findAll.mockResolvedValueOnce([
        {
          id: 'ip-a',
          userId: 'u-a',
          displayName: 'Coach A',
          bio: 'A bio',
          specializations: ['hiit'],
          yearsOfExperience: 7,
          isAcceptingClients: true,
          socialLinks: { instagram: 'https://insta/a' },
          showSocialLinks: true,
          user: {
            handle: 'coach-a',
            firstName: 'A',
            lastName: 'Last',
            avatarId: 1,
            avatarUrl: null,
            city: 'Cluj',
            countryCode: 'RO',
          },
        },
      ]);

      const out = await service.discoverInstructors({ page: 1, limit: 20 });

      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        id: 'ip-a',
        userId: 'u-a',
        handle: 'coach-a',
        firstName: 'A',
        lastName: 'Last',
        displayName: 'Coach A',
        city: 'Cluj',
        countryCode: 'RO',
        socialLinks: { instagram: 'https://insta/a' },
      });
    });

    it('hides socialLinks when the instructor toggled them off', async () => {
      instructorProfileModel.findAll.mockResolvedValueOnce([
        {
          id: 'ip-b',
          userId: 'u-b',
          displayName: 'Coach B',
          bio: null,
          specializations: [],
          yearsOfExperience: null,
          isAcceptingClients: true,
          socialLinks: { instagram: 'https://insta/b' },
          showSocialLinks: false, // ← user opted out
          user: {
            handle: null,
            firstName: 'B',
            lastName: 'B',
            avatarId: 1,
            avatarUrl: null,
            city: null,
            countryCode: null,
          },
        },
      ]);

      const out = await service.discoverInstructors({});
      expect(out[0].socialLinks).toBeNull();
    });
  });

  describe('suggestInstructors', () => {
    const row = {
      id: 'ip-c',
      userId: 'u-c',
      displayName: 'Coach C',
      specializations: ['yoga'],
      yearsOfExperience: 3,
      user: {
        handle: 'coach-c',
        firstName: 'C',
        lastName: 'Last',
        avatarUrl: 'https://img/c.jpg',
        city: 'Iasi',
        countryCode: 'RO',
      },
    };

    it('returns each coach with the user id and a SUGGESTED reason', async () => {
      instructorProfileModel.findAll.mockResolvedValueOnce([row]);

      const out = await service.suggestInstructors(me, { limit: 10 });

      expect(out).toEqual([
        {
          id: 'ip-c',
          userId: 'u-c',
          handle: 'coach-c',
          firstName: 'C',
          lastName: 'Last',
          avatarUrl: 'https://img/c.jpg',
          displayName: 'Coach C',
          specializations: ['yoga'],
          yearsOfExperience: 3,
          city: 'Iasi',
          countryCode: 'RO',
          reason: 'SUGGESTED',
        },
      ]);
    });

    it('takes only users with the coach role who accept clients, minus the caller, their coaches and blocks', async () => {
      instructorProfileModel.findAll.mockResolvedValueOnce([]);

      await service.suggestInstructors(me, { limit: 5 });

      const [[query]] = instructorProfileModel.findAll.mock.calls as [
        [
          {
            limit: number;
            where: {
              isAcceptingClients: boolean;
              userId: Record<symbol, string>;
              [Op.and]: unknown[];
            };
          },
        ],
      ];
      expect(query.limit).toBe(5);
      expect(query.where.isAcceptingClients).toBe(true);
      expect(query.where.userId[Op.ne]).toBe(me);

      const filters = JSON.stringify(query.where[Op.and]);
      expect(filters).toContain("r.name = 'INSTRUCTOR'");
      expect(filters).toContain('instructor_client');
      expect(filters).toContain('user_block');
      expect(filters).toContain(`'${me}'`);
    });
  });

  // ───── updateHandle ───────────────────────────────────────────────

  describe('updateHandle', () => {
    it('throws ConflictException when another user already owns the handle', async () => {
      jest
        .spyOn(User, 'findOne')
        // First call inside the tx: the conflict pre-check.
        .mockResolvedValueOnce({ id: stranger } as unknown as User);

      await expect(
        service.updateHandle(me, { handle: 'taken' }),
      ).rejects.toThrow(ConflictException);
    });

    it('persists the normalized (lower-cased + trimmed) handle on success', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(null);
      jest
        .spyOn(User, 'findByPk')
        .mockResolvedValueOnce({ id: me, update } as unknown as User);

      const out = await service.updateHandle(me, { handle: '  Jane-Doe  ' });

      expect(out).toEqual({ handle: 'jane-doe' });
      expect(update).toHaveBeenCalledWith(
        { handle: 'jane-doe' },
        expect.objectContaining({ transaction: fakeTx }),
      );
    });
  });

  // ───── updatePrivacySettings ──────────────────────────────────────

  describe('updatePrivacySettings', () => {
    it('merges the patch into existing settings without dropping prior keys', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(User, 'findByPk').mockResolvedValueOnce({
        id: me,
        privacySettings: { email: 'ONLY_ME', city: 'PUBLIC' },
        update,
      } as unknown as User);

      const out = await service.updatePrivacySettings(me, {
        email: 'PUBLIC',
      });

      // Pre-existing `city` survives; `email` flips to PUBLIC.
      expect(out.privacySettings).toEqual({
        email: 'PUBLIC',
        city: 'PUBLIC',
      });
      expect(update).toHaveBeenCalledWith(
        { privacySettings: { email: 'PUBLIC', city: 'PUBLIC' } },
        expect.objectContaining({ transaction: fakeTx }),
      );
    });

    it('returns current settings (no write) when the patch is empty', async () => {
      jest.spyOn(User, 'findByPk').mockResolvedValueOnce({
        id: me,
        privacySettings: { email: 'ONLY_ME' },
      } as unknown as User);

      const out = await service.updatePrivacySettings(me, {});

      expect(out.privacySettings).toEqual({ email: 'ONLY_ME' });
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });
  });

  // ───── getPublicUserWorkouts ──────────────────────────────────────

  describe('getPublicUserWorkouts — which levels a profile shows', () => {
    const owner = { id: 'u-1', handle: 'jane' } as unknown as User;
    const levelsFor = async (
      viewerId: string | null,
      isCoach: boolean,
      previewAs?: 'PUBLIC' | 'COACH',
    ) => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(owner);
      jest
        .spyOn(InstructorClient, 'findAll')
        .mockResolvedValueOnce(
          (isCoach
            ? [{ instructorId: viewerId }]
            : []) as unknown as InstructorClient[],
        );
      await service.getPublicUserWorkouts('jane', viewerId, {
        page: 1,
        limit: 20,
        previewAs,
      });
      return workoutLogService.listForProfile.mock.calls.at(-1)?.[1];
    };

    it('shows only Public workouts to someone not signed in', async () => {
      expect(await levelsFor(null, false)).toEqual(['PUBLIC']);
    });

    it('shows a signed-in stranger only Public ones too', async () => {
      expect(await levelsFor(stranger, false)).toEqual(['PUBLIC']);
    });

    it('adds Coaches only for an active coach of theirs', async () => {
      expect(await levelsFor('coach-1', true)).toEqual([
        'PUBLIC',
        'COACHES_ONLY',
      ]);
    });

    it('shows the owner their page as the public would', async () => {
      expect(await levelsFor('u-1', false)).toEqual(['PUBLIC']);
    });

    it('shows the owner what their coaches see when previewing that', async () => {
      expect(await levelsFor('u-1', false, 'COACH')).toEqual([
        'PUBLIC',
        'COACHES_ONLY',
      ]);
    });

    it('never lets anyone else borrow the coach view', async () => {
      expect(await levelsFor(stranger, false, 'COACH')).toEqual(['PUBLIC']);
    });

    it('does not pass the preview on as a list filter', async () => {
      await levelsFor('u-1', false, 'COACH');
      expect(workoutLogService.listForProfile.mock.calls.at(-1)?.[2]).toEqual({
        page: 1,
        limit: 20,
      });
    });
  });

  describe('getPublicUserWorkout — one workout, same rule', () => {
    it('looks the workout up with the levels this viewer sees', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce({
        id: 'u-1',
        handle: 'jane',
      } as unknown as User);
      jest
        .spyOn(InstructorClient, 'findAll')
        .mockResolvedValueOnce([
          { instructorId: 'coach-1' },
        ] as unknown as InstructorClient[]);
      workoutLogService.findForProfile.mockResolvedValueOnce({ id: 'wl-1' });

      await expect(
        service.getPublicUserWorkout('jane', 'coach-1', 'wl-1'),
      ).resolves.toEqual({ id: 'wl-1' });
      expect(workoutLogService.findForProfile).toHaveBeenCalledWith(
        'u-1',
        ['PUBLIC', 'COACHES_ONLY'],
        'wl-1',
      );
    });
  });

  describe("getPublicUserWorkoutPhoto — the workout's own rule", () => {
    const owner = { id: 'u-1', handle: 'jane' } as unknown as User;

    it('asks for the photo under the levels this viewer sees', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(owner);
      jest
        .spyOn(InstructorClient, 'findAll')
        .mockResolvedValueOnce([] as unknown as InstructorClient[]);

      await service.getPublicUserWorkoutPhoto(
        'jane',
        stranger,
        'wl-1',
        'COACH',
      );

      // A stranger cannot borrow the coach view.
      expect(workoutPhotoService.photoForProfile).toHaveBeenCalledWith(
        'u-1',
        ['PUBLIC'],
        'wl-1',
      );
    });

    it('lets the owner preview what their coaches see', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(owner);

      await service.getPublicUserWorkoutPhoto('jane', 'u-1', 'wl-1', 'COACH');

      expect(workoutPhotoService.photoForProfile).toHaveBeenCalledWith(
        'u-1',
        ['PUBLIC', 'COACHES_ONLY'],
        'wl-1',
      );
    });
  });

  describe('reportUserWorkout — you report what you can see', () => {
    const owner = { id: 'u-1', handle: 'jane' } as unknown as User;

    it('checks the report against the levels the reporter sees on that profile', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(owner);
      jest
        .spyOn(InstructorClient, 'findAll')
        .mockResolvedValueOnce([
          { instructorId: 'coach-1' },
        ] as unknown as InstructorClient[]);

      await service.reportUserWorkout('jane', 'coach-1', 'wl-1', {
        category: MessageReportCategory.HARASSMENT,
        notes: 'Mocks another member',
      });

      expect(workoutReportService.submit).toHaveBeenCalledWith({
        reporterId: 'coach-1',
        ownerId: 'u-1',
        workoutLogId: 'wl-1',
        levels: ['PUBLIC', 'COACHES_ONLY'],
        category: MessageReportCategory.HARASSMENT,
        notes: 'Mocks another member',
      });
    });

    it('is a 404 for a handle that is gone', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(null);
      await expect(
        service.reportUserWorkout('ghost', 'me', 'wl-1', {
          category: MessageReportCategory.SPAM,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(workoutReportService.submit).not.toHaveBeenCalled();
    });
  });

  // ───── getPublicUserProfileByHandle ───────────────────────────────

  describe('getPublicUserProfileByHandle', () => {
    it('404s on an empty handle (no DB hit)', async () => {
      await expect(
        service.getPublicUserProfileByHandle('   ', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s when no user owns that handle', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(null);
      await expect(
        service.getPublicUserProfileByHandle('ghost', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns PUBLIC audience for anonymous viewers and masks private fields', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce({
        id: 'u-1',
        handle: 'jane',
        firstName: 'Jane',
        lastName: 'Doe',
        avatarUrl: null,
        email: 'jane@example.com',
        phone: '+40700',
        city: 'Bucharest',
        countryCode: 'RO',
        language: 'en',
        timezone: 'Europe/Bucharest',
        privacySettings: {},
        createdAt: new Date('2024-01-01'),
      } as unknown as User);
      instructorProfileModel.findOne.mockResolvedValueOnce(null);
      roleService.getUserRoles.mockResolvedValueOnce([
        { name: 'USER' },
        { name: 'INSTRUCTOR' },
      ]);

      const out = await service.getPublicUserProfileByHandle('jane', null);

      expect(out.audience).toBe('PUBLIC');
      // Defaults: email + phone are ONLY_ME → masked.
      expect(out.email).toBeNull();
      expect(out.phone).toBeNull();
      // Defaults: firstName + city are PUBLIC → surfaced.
      expect(out.firstName).toBe('Jane');
      expect(out.city).toBe('Bucharest');
      // USER role is filtered out of displayRoles.
      expect(out.displayRoles).toEqual(['INSTRUCTOR']);
      expect(out.isInstructor).toBe(false);
    });

    it('resolves OWNER audience when the viewer is the profile owner', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce({
        id: me,
        handle: 'me-handle',
        firstName: 'Me',
        lastName: 'Self',
        avatarUrl: null,
        email: 'me@example.com',
        phone: null,
        city: null,
        countryCode: null,
        language: null,
        timezone: null,
        privacySettings: {},
        createdAt: new Date(),
      } as unknown as User);
      instructorProfileModel.findOne.mockResolvedValueOnce({ id: 'ip-1' });
      roleService.getUserRoles.mockResolvedValueOnce([]);

      const out = await service.getPublicUserProfileByHandle('me-handle', me);

      expect(out.audience).toBe('OWNER');
      expect(out.isInstructor).toBe(true);
    });

    it('resolves COACH audience via the InstructorClient lookup', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce({
        id: 'client-1',
        handle: 'client',
        firstName: 'C',
        lastName: 'L',
        avatarUrl: null,
        email: 'c@x',
        phone: null,
        city: null,
        countryCode: null,
        language: null,
        timezone: null,
        privacySettings: {},
        createdAt: new Date(),
      } as unknown as User);
      jest
        .spyOn(InstructorClient, 'findAll')
        .mockResolvedValueOnce([
          { instructorId: 'coach-1' },
        ] as unknown as InstructorClient[]);
      instructorProfileModel.findOne.mockResolvedValueOnce(null);
      roleService.getUserRoles.mockResolvedValueOnce([]);

      groupService.sharedGroups.mockResolvedValueOnce([
        { id: 'g-1', name: 'Morning Crew', logoUrl: null },
      ]);

      const out = await service.getPublicUserProfileByHandle(
        'client',
        'coach-1',
      );
      expect(out.audience).toBe('COACH');
      // Groups in common are looked up for the signed-in viewer.
      expect(groupService.sharedGroups).toHaveBeenCalledWith(
        'coach-1',
        'client-1',
      );
      expect(out.sharedGroups).toEqual([
        { id: 'g-1', name: 'Morning Crew', logoUrl: null },
      ]);
    });

    it('has no groups in common for a guest or for your own profile', async () => {
      const user = {
        id: me,
        handle: 'me-handle',
        firstName: 'Me',
        lastName: 'Self',
        avatarUrl: null,
        email: null,
        phone: null,
        city: null,
        countryCode: null,
        language: null,
        timezone: null,
        privacySettings: {},
        createdAt: new Date(),
      } as unknown as User;
      groupService.sharedGroups.mockClear();
      instructorProfileModel.findOne.mockResolvedValue(null);
      roleService.getUserRoles.mockResolvedValue([]);

      jest.spyOn(User, 'findOne').mockResolvedValueOnce(user);
      const guest = await service.getPublicUserProfileByHandle(
        'me-handle',
        null,
      );
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(user);
      const own = await service.getPublicUserProfileByHandle('me-handle', me);

      expect(guest.sharedGroups).toEqual([]);
      expect(own.sharedGroups).toEqual([]);
      expect(groupService.sharedGroups).not.toHaveBeenCalled();
    });

    const person = (fields: Record<string, unknown> = {}) =>
      ({
        id: 'coach-1',
        handle: 'alex',
        firstName: 'Alex',
        lastName: 'Rivera',
        avatarUrl: null,
        email: 'alex@example.com',
        phone: null,
        city: null,
        countryCode: null,
        language: 'en',
        timezone: 'Europe/Bucharest',
        privacySettings: {},
        createdAt: new Date('2026-07-01'),
        ...fields,
      }) as unknown as User;

    it("says since when the person is the viewer's coach", async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(person());
      const since = new Date('2026-03-12');
      const findAll = jest
        .spyOn(InstructorClient, 'findAll')
        .mockResolvedValueOnce([
          { instructorId: 'coach-1', startedAt: since, createdAt: new Date() },
        ] as unknown as InstructorClient[]);
      instructorProfileModel.findOne.mockResolvedValueOnce({ id: 'ip-1' });
      roleService.getUserRoles.mockResolvedValueOnce([]);
      groupService.sharedGroups.mockResolvedValueOnce([]);

      const out = await service.getPublicUserProfileByHandle('alex', 'me');

      expect(out.yourCoachSince).toEqual(since);
      // Coaching me is not me coaching them: no coach-only fields.
      expect(out.audience).toBe('PUBLIC');
      expect(out.language).toBeNull();
      // Both directions in one query, active links only.
      expect(findAll).toHaveBeenCalledTimes(1);
      expect(findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('has no coach-since for a stranger, a guest or the owner', async () => {
      instructorProfileModel.findOne.mockResolvedValue(null);
      roleService.getUserRoles.mockResolvedValue([]);
      groupService.sharedGroups.mockResolvedValue([]);
      const findAll = jest
        .spyOn(InstructorClient, 'findAll')
        .mockResolvedValueOnce([] as unknown as InstructorClient[]);

      jest.spyOn(User, 'findOne').mockResolvedValueOnce(person());
      const stranger = await service.getPublicUserProfileByHandle('alex', 'me');
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(person());
      const guest = await service.getPublicUserProfileByHandle('alex', null);
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(person());
      const own = await service.getPublicUserProfileByHandle('alex', 'coach-1');

      expect(stranger.yourCoachSince).toBeNull();
      expect(guest.yourCoachSince).toBeNull();
      expect(own.yourCoachSince).toBeNull();
      // Only the stranger needed a lookup.
      expect(findAll).toHaveBeenCalledTimes(1);
    });

    it('shows the owner the coach slice when previewing as their coaches', async () => {
      instructorProfileModel.findOne.mockResolvedValue(null);
      roleService.getUserRoles.mockResolvedValue([]);

      jest.spyOn(User, 'findOne').mockResolvedValueOnce(person());
      const asPublic = await service.getPublicUserProfileByHandle(
        'alex',
        'coach-1',
      );
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(person());
      const asCoach = await service.getPublicUserProfileByHandle(
        'alex',
        'coach-1',
        'COACH',
      );

      // Language goes to coaches by default; email stays theirs alone.
      expect(asPublic.language).toBeNull();
      expect(asCoach.language).toBe('en');
      expect(asCoach.email).toBeNull();
      expect(asCoach.audience).toBe('OWNER');
      expect(workoutLogService.countForProfile).toHaveBeenLastCalledWith(
        'coach-1',
        ['PUBLIC', 'COACHES_ONLY'],
      );
    });

    it('ignores the coach preview from anyone but the owner', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValueOnce(person());
      jest
        .spyOn(InstructorClient, 'findAll')
        .mockResolvedValueOnce([] as unknown as InstructorClient[]);
      instructorProfileModel.findOne.mockResolvedValueOnce(null);
      roleService.getUserRoles.mockResolvedValueOnce([]);
      groupService.sharedGroups.mockResolvedValueOnce([]);

      const out = await service.getPublicUserProfileByHandle(
        'alex',
        'me',
        'COACH',
      );

      expect(out.language).toBeNull();
      expect(workoutLogService.countForProfile).toHaveBeenLastCalledWith(
        'coach-1',
        ['PUBLIC'],
      );
    });
  });
});
