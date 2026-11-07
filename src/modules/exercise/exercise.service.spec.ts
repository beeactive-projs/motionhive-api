import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { ExerciseService } from './exercise.service';
import { Exercise } from './entities/exercise.entity';
import { ExerciseMuscle } from './entities/exercise-muscle.entity';
import { ExerciseEquipment } from './entities/exercise-equipment.entity';
import { ExerciseMedia } from './entities/exercise-media.entity';
import { Muscle } from './entities/muscle.entity';
import { Equipment } from './entities/equipment.entity';
import { User } from '../user/entities/user.entity';
import {
  ExerciseKind,
  ExerciseSource,
  ExerciseVisibility,
  MuscleRole,
} from './entities/exercise.enums';
import { SearchIndexService } from '../search/search-index.service';
import { ExerciseSearchService } from './exercise-search.service';
import { ExerciseSortKey } from './dto/list-exercises.query.dto';
import { buildSearchPlan } from './search/exercise-search';
import { NotificationService } from '../notification/notification.service';
import { MediaStorageService } from '../../common/services/media-storage.service';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Smoke tests for ExerciseService. Two layers:
 *   1. Validation + ownership + visibility — pure-logic paths that
 *      would silently regress if touched.
 *   2. Happy-path transactions for create/fork/softDelete — assert the
 *      tx wrapper is called, the right ORM writes are issued, and the
 *      counter accounting is correct.
 *
 * Faceted list aggregation and the actual search-doc/notification
 * pipeline live in the seed + manual Swagger probe; mocking the include
 * shape end-to-end here would be more noise than signal.
 */
describe('ExerciseService (smoke — not exhaustive)', () => {
  let service: ExerciseService;

  const exerciseModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    increment: jest.fn(),
  };
  const exerciseMuscleModel = { bulkCreate: jest.fn(), destroy: jest.fn() };
  const exerciseEquipmentModel = { bulkCreate: jest.fn(), destroy: jest.fn() };
  const exerciseMediaModel = { bulkCreate: jest.fn(), destroy: jest.fn() };
  const muscleModel = { findAll: jest.fn() };
  const equipmentModel = { findAll: jest.fn() };
  const userModel = { findByPk: jest.fn() };
  const sequelize = {
    transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb(fakeTx)),
    ),
    query: jest.fn(),
    escape: jest.fn((v: string) => `'${v}'`),
  };
  const searchIndex = {
    upsertExercise: jest.fn().mockResolvedValue(undefined),
    removeIfExists: jest.fn().mockResolvedValue(undefined),
  };
  const exerciseSearch = {
    plan: jest.fn().mockResolvedValue(null),
    personalScores: jest.fn().mockResolvedValue(new Map()),
  };
  const notificationService = {
    notify: jest.fn().mockResolvedValue(undefined),
  };
  const mediaStorage = {
    uploadImage: jest.fn().mockResolvedValue({
      url: 'https://img.motionhive.fit/motionhive/test/exercises/me/pic.jpg',
      publicId: 'motionhive/test/exercises/me/pic',
    }),
  };

  const meInstructor = {
    userId: 'me',
    isInstructor: true,
    locale: 'en',
  } as const;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        ExerciseService,
        { provide: getModelToken(Exercise), useValue: exerciseModel },
        {
          provide: getModelToken(ExerciseMuscle),
          useValue: exerciseMuscleModel,
        },
        {
          provide: getModelToken(ExerciseEquipment),
          useValue: exerciseEquipmentModel,
        },
        {
          provide: getModelToken(ExerciseMedia),
          useValue: exerciseMediaModel,
        },
        { provide: getModelToken(Muscle), useValue: muscleModel },
        { provide: getModelToken(Equipment), useValue: equipmentModel },
        { provide: getModelToken(User), useValue: userModel },
        { provide: Sequelize, useValue: sequelize },
        { provide: SearchIndexService, useValue: searchIndex },
        { provide: ExerciseSearchService, useValue: exerciseSearch },
        { provide: NotificationService, useValue: notificationService },
        { provide: MediaStorageService, useValue: mediaStorage },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(ExerciseService);
  });

  // ─── Browse gate (originally locked decision §19; lifted post-freestyle) ───

  describe('canClientBrowseCatalog', () => {
    it('returns true for an instructor without touching the DB', async () => {
      const result = await service.canClientBrowseCatalog(meInstructor);
      expect(result).toBe(true);
      expect(userModel.findByPk).not.toHaveBeenCalled();
      expect(sequelize.query).not.toHaveBeenCalled();
    });

    it('returns true for any signed-in client (gate lifted)', async () => {
      const result = await service.canClientBrowseCatalog({
        userId: 'u',
        isInstructor: false,
        locale: 'en',
      });
      expect(result).toBe(true);
      // The gate now no-ops so we shouldn't hit the DB for it.
      expect(userModel.findByPk).not.toHaveBeenCalled();
      expect(sequelize.query).not.toHaveBeenCalled();
    });

    it('assertClientCanBrowse is now a no-op', async () => {
      await expect(
        service.assertClientCanBrowse({
          userId: 'u',
          isInstructor: false,
          locale: 'en',
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── Create validation (locked decision §20) ─────────────────────

  describe('create — muscle-role invariants', () => {
    const baseDto = {
      name: 'Test exercise',
      kind: ExerciseKind.Strength,
      muscles: [],
    };

    it('rejects an exercise with no PRIMARY muscle', async () => {
      await expect(
        service.create(
          {
            ...baseDto,
            muscles: [{ muscleId: 'm-1', role: MuscleRole.Secondary }],
          },
          'owner-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects more than 3 PRIMARY muscles', async () => {
      await expect(
        service.create(
          {
            ...baseDto,
            muscles: [
              { muscleId: 'm-1', role: MuscleRole.Primary },
              { muscleId: 'm-2', role: MuscleRole.Primary },
              { muscleId: 'm-3', role: MuscleRole.Primary },
              { muscleId: 'm-4', role: MuscleRole.Primary },
            ],
          },
          'owner-1',
        ),
      ).rejects.toThrow(/primary muscles/);
    });

    it('rejects duplicate (muscle, role) pairs', async () => {
      await expect(
        service.create(
          {
            ...baseDto,
            muscles: [
              { muscleId: 'm-1', role: MuscleRole.Primary },
              { muscleId: 'm-1', role: MuscleRole.Primary },
            ],
          },
          'owner-1',
        ),
      ).rejects.toThrow(/listed twice/);
    });
  });

  // ─── Create happy path (T1) ──────────────────────────────────────

  describe('create — happy path', () => {
    it('wraps inserts in a single transaction and attaches muscle + equipment rows', async () => {
      // No slug collision on first lookup.
      exerciseModel.findOne.mockResolvedValueOnce(null);
      const created = {
        id: 'new-id',
        ownerId: 'owner-1',
        source: ExerciseSource.Instructor,
        visibility: ExerciseVisibility.Private,
      };
      exerciseModel.create.mockResolvedValueOnce(created);
      // reloadDetail at the end
      exerciseModel.findByPk.mockResolvedValueOnce({
        ...created,
        muscleRoles: [],
      });

      await service.create(
        {
          name: 'Tempo squat',
          kind: ExerciseKind.Strength,
          muscles: [{ muscleId: 'm-quads', role: MuscleRole.Primary }],
          equipmentIds: ['eq-kettlebell'],
        },
        'owner-1',
      );

      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(exerciseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Tempo squat',
          slug: 'tempo-squat',
          source: ExerciseSource.Instructor,
          ownerId: 'owner-1',
          visibility: ExerciseVisibility.Private,
          forkCount: 0,
        }),
        { transaction: fakeTx },
      );
      expect(exerciseMuscleModel.bulkCreate).toHaveBeenCalledWith(
        [
          {
            exerciseId: 'new-id',
            muscleId: 'm-quads',
            role: MuscleRole.Primary,
          },
        ],
        { transaction: fakeTx },
      );
      expect(exerciseEquipmentModel.bulkCreate).toHaveBeenCalledWith(
        [{ exerciseId: 'new-id', equipmentId: 'eq-kettlebell' }],
        { transaction: fakeTx },
      );
      expect(searchIndex.upsertExercise).toHaveBeenCalledWith('new-id');
    });
  });

  // ─── Update — ownership policy ───────────────────────────────────

  describe('update — ownership', () => {
    it('throws NotFound when the exercise does not exist', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce(null);

      await expect(
        service.update('missing', { name: 'X' }, meInstructor),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound when the exercise belongs to another instructor (hides existence)', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'e-1',
        source: ExerciseSource.Instructor,
        ownerId: 'other-owner',
      });

      await expect(
        service.update('e-1', { name: 'New name' }, meInstructor),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound on SYSTEM exercises (never editable via this surface)', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'e-sys',
        source: ExerciseSource.System,
        ownerId: null,
      });

      await expect(
        service.update('e-sys', { name: 'New name' }, meInstructor),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findById visibility filter ──────────────────────────────────

  describe('findById — visibility filter', () => {
    it('hides a private exercise from a non-owner', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'e-1',
        source: ExerciseSource.Instructor,
        ownerId: 'other-owner',
        visibility: ExerciseVisibility.Private,
      });

      await expect(service.findById('e-1', meInstructor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns SYSTEM exercises to any caller', async () => {
      const sys = {
        id: 'e-sys',
        source: ExerciseSource.System,
        ownerId: null,
        visibility: ExerciseVisibility.Public,
      };
      exerciseModel.findByPk.mockResolvedValueOnce(sys);

      const result = await service.findById('e-sys', {
        userId: 'me',
        isInstructor: false,
        locale: 'en',
      });
      expect(result).toBe(sys);
    });

    it('returns PUBLIC instructor exercises to other instructors', async () => {
      const pub = {
        id: 'e-pub',
        source: ExerciseSource.Instructor,
        ownerId: 'other-owner',
        visibility: ExerciseVisibility.Public,
      };
      exerciseModel.findByPk.mockResolvedValueOnce(pub);

      const result = await service.findById('e-pub', meInstructor);
      expect(result).toBe(pub);
    });
  });

  // ─── Fork preconditions + happy path + decrement (T3) ────────────

  describe('fork', () => {
    it('hides existence when the source is PRIVATE', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'src',
        ownerId: 'other',
        visibility: ExerciseVisibility.Private,
        muscleRoles: [],
        equipment: [],
      });

      await expect(service.fork('src', meInstructor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects forking your own exercise', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'src',
        ownerId: 'me',
        visibility: ExerciseVisibility.Public,
        muscleRoles: [],
        equipment: [],
      });

      await expect(service.fork('src', meInstructor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns 409 when the same instructor already has a live fork', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'src',
        ownerId: 'other',
        visibility: ExerciseVisibility.Public,
        muscleRoles: [],
        equipment: [],
      });
      exerciseModel.findOne.mockResolvedValueOnce({ id: 'existing-fork' });

      await expect(service.fork('src', meInstructor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('clones in a tx and increments source.fork_count (atomic), then re-reads for the notification body', async () => {
      const source = {
        id: 'src',
        ownerId: 'other-owner',
        visibility: ExerciseVisibility.Public,
        name: 'Source ex',
        slug: 'source-ex',
        description: null,
        instructions: null,
        kind: ExerciseKind.Strength,
        level: 'BEGINNER',
        movementPattern: null,
        mechanic: null,
        force: null,
        metValue: null,
        isUnilateral: false,
        mediaKind: 'NONE',
        thumbnailUrl: null,
        youtubeUrl: null,
        forkCount: 41,
        muscleRoles: [{ muscleId: 'm-1', role: MuscleRole.Primary }],
        equipment: [{ id: 'eq-1' }],
      };
      exerciseModel.findByPk
        .mockResolvedValueOnce(source) // initial load with includes
        .mockResolvedValueOnce({ forkCount: 42 }) // post-increment re-read
        .mockResolvedValueOnce({ id: 'fork-id' }); // reloadDetail
      exerciseModel.findOne.mockResolvedValueOnce(null); // no existing fork
      // Slug allocator findOne (also returns null for "no collision")
      exerciseModel.findOne.mockResolvedValueOnce(null);
      exerciseModel.create.mockResolvedValueOnce({ id: 'fork-id' });

      await service.fork('src', meInstructor);

      expect(exerciseModel.increment).toHaveBeenCalledWith(
        { forkCount: 1 },
        { where: { id: 'src' }, transaction: fakeTx },
      );
      // notification body uses the post-increment count (42), not the
      // stale local source.forkCount (41).
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            params: expect.objectContaining({ count: 42 }),
          }),
        }),
      );
    });
  });

  // ─── Soft-delete — fork_count decrement (T3) ─────────────────────

  describe('softDelete', () => {
    it('throws NotFound when not the owner (hides existence)', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'e-1',
        source: ExerciseSource.Instructor,
        ownerId: 'other',
      });

      await expect(service.softDelete('e-1', meInstructor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('decrements source.fork_count when the deleted row is a fork', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'fork-id',
        source: ExerciseSource.Instructor,
        ownerId: 'me',
        forkedFromId: 'src-id',
        destroy,
      });

      await service.softDelete('fork-id', meInstructor);

      expect(destroy).toHaveBeenCalledWith({ transaction: fakeTx });
      expect(exerciseModel.increment).toHaveBeenCalledWith(
        { forkCount: -1 },
        expect.objectContaining({
          where: expect.objectContaining({ id: 'src-id' }),
          transaction: fakeTx,
        }),
      );
    });

    it('does NOT touch fork_count when the row is not a fork', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'original',
        source: ExerciseSource.Instructor,
        ownerId: 'me',
        forkedFromId: null,
        destroy,
      });

      await service.softDelete('original', meInstructor);

      expect(destroy).toHaveBeenCalled();
      expect(exerciseModel.increment).not.toHaveBeenCalled();
    });
  });

  // ─── Slug allocator (T4) ─────────────────────────────────────────

  describe('slug allocation', () => {
    it("retries with '-2' / '-3' suffixes when the base slug is taken", async () => {
      exerciseModel.findOne
        .mockResolvedValueOnce({ id: 'collide-1' }) // 'tempo-squat' taken
        .mockResolvedValueOnce({ id: 'collide-2' }) // 'tempo-squat-2' taken
        .mockResolvedValueOnce(null); // 'tempo-squat-3' free
      exerciseModel.create.mockResolvedValueOnce({ id: 'new' });
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'new',
        muscleRoles: [],
      });

      await service.create(
        {
          name: 'Tempo squat',
          kind: ExerciseKind.Strength,
          muscles: [{ muscleId: 'm-1', role: MuscleRole.Primary }],
        },
        'owner-1',
      );

      expect(exerciseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'tempo-squat-3' }),
        expect.anything(),
      );
    });
  });

  // ─── Own exercises for everyone (workouts round 2) ───────────────

  describe('own exercises for someone who is not a coach', () => {
    const meClient = {
      userId: 'me',
      isInstructor: false,
      locale: 'en',
    } as const;

    const created = {
      id: 'own-1',
      ownerId: 'me',
      source: ExerciseSource.User,
      visibility: ExerciseVisibility.Private,
    };

    it('creates a USER exercise, always private, with no muscles needed', async () => {
      exerciseModel.findOne.mockResolvedValueOnce(null); // slug free
      exerciseModel.create.mockResolvedValueOnce(created);
      exerciseModel.findByPk.mockResolvedValueOnce(created); // reloadDetail

      await service.create(
        {
          name: 'Cable thing at my gym',
          kind: ExerciseKind.Strength,
          // Sent, but someone's own exercise is private by rule.
          visibility: ExerciseVisibility.Public,
        },
        'me',
        false,
      );

      expect(exerciseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: ExerciseSource.User,
          ownerId: 'me',
          visibility: ExerciseVisibility.Private,
        }),
        { transaction: fakeTx },
      );
      expect(exerciseMuscleModel.bulkCreate).not.toHaveBeenCalled();
    });

    it('takes the muscle chips when they are picked', async () => {
      exerciseModel.findOne.mockResolvedValueOnce(null);
      exerciseModel.create.mockResolvedValueOnce(created);
      exerciseModel.findByPk.mockResolvedValueOnce(created);

      await service.create(
        {
          name: 'Cable thing',
          kind: ExerciseKind.Strength,
          muscles: [{ muscleId: 'm-chest', role: MuscleRole.Primary }],
        },
        'me',
        false,
      );

      expect(exerciseMuscleModel.bulkCreate).toHaveBeenCalledWith(
        [
          {
            exerciseId: 'own-1',
            muscleId: 'm-chest',
            role: MuscleRole.Primary,
          },
        ],
        { transaction: fakeTx },
      );
    });

    it('still asks a coach for a primary muscle', async () => {
      await expect(
        service.create(
          { name: 'Coach thing', kind: ExerciseKind.Strength },
          'coach-1',
          true,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(exerciseModel.create).not.toHaveBeenCalled();
    });

    it('keeps an own exercise private on edit, whatever is sent', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      exerciseModel.findByPk
        .mockResolvedValueOnce({ ...created, name: 'Cable thing', update })
        .mockResolvedValueOnce(created); // reloadDetail

      await service.update(
        'own-1',
        { visibility: ExerciseVisibility.Public, isUnilateral: true },
        meClient,
      );

      const [fields] = update.mock.calls[0] as [Record<string, unknown>];
      expect(fields).toEqual({ isUnilateral: true });
    });

    it("lets nobody else edit or delete someone's own exercise", async () => {
      exerciseModel.findByPk.mockResolvedValue({ ...created, ownerId: 'u-2' });

      await expect(
        service.update('own-1', { name: 'Mine now' }, meClient),
      ).rejects.toThrow(NotFoundException);
      await expect(service.softDelete('own-1', meClient)).rejects.toThrow(
        NotFoundException,
      );
      exerciseModel.findByPk.mockReset();
    });

    it('lets the owner delete it (soft, so its history stays)', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      exerciseModel.findByPk.mockResolvedValueOnce({
        ...created,
        forkedFromId: null,
        destroy,
      });

      await service.softDelete('own-1', meClient);

      expect(destroy).toHaveBeenCalledWith({ transaction: fakeTx });
    });

    describe('the list', () => {
      const conditions = (): unknown[] => {
        const [{ where }] = exerciseModel.findAndCountAll.mock.calls[0] as [
          { where: Record<symbol, unknown[]> },
        ];
        return where[Op.and];
      };

      beforeEach(() => {
        exerciseModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
      });

      it('answers "mine" with what they made', async () => {
        await service.list({ ownership: 'mine' }, meClient);

        expect(conditions()).toContainEqual({ ownerId: 'me' });
      });

      it('shows their own beside ours and the public ones under "all"', async () => {
        await service.list({}, meClient);

        expect(conditions()).toContainEqual({
          [Op.or]: [
            { source: ExerciseSource.System },
            { visibility: ExerciseVisibility.Public },
            { ownerId: 'me' },
          ],
        });
      });
    });
  });

  describe('list order', () => {
    const taxonomy = { muscles: [], equipment: [] };
    const orderSql = (): string =>
      JSON.stringify(
        (exerciseModel.findAndCountAll.mock.calls[0] as [{ order: unknown }])[0]
          .order,
      );
    const candidate = (id: string, name: string, popularity: number) => ({
      id,
      name,
      localeName: name,
      searchName: name.toLowerCase(),
      popularity,
      primaryMuscleIds: [],
      secondaryMuscleIds: [],
      equipmentIds: [],
    });

    beforeEach(() => {
      exerciseModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
      exerciseSearch.plan.mockResolvedValue(null);
      exerciseSearch.personalScores.mockResolvedValue(new Map());
    });

    it('browses by what people use most when nothing is typed', async () => {
      exerciseSearch.personalScores.mockResolvedValueOnce(
        new Map([['e-1', 0.8]]),
      );

      await service.list({}, meInstructor);

      expect(exerciseSearch.personalScores).toHaveBeenCalledWith('me');
      expect(orderSql()).toContain('popularity_score');
      expect(orderSql()).toContain('{\\"e-1\\":0.8}');
    });

    it('keeps A to Z for sort=name with nothing typed', async () => {
      await service.list({ sort: ExerciseSortKey.Name }, meInstructor);

      expect(exerciseSearch.personalScores).not.toHaveBeenCalled();
      expect(orderSql()).not.toContain('popularity_score');
    });

    it.each([ExerciseSortKey.Relevance, ExerciseSortKey.Name])(
      'ranks a search best match first (sort=%s), then pages the ranking',
      async (sort) => {
        exerciseSearch.plan.mockResolvedValueOnce(
          buildSearchPlan('deadlift', taxonomy),
        );
        exerciseModel.findAll.mockImplementation((options: { raw?: boolean }) =>
          Promise.resolve(
            options.raw
              ? [
                  candidate('axle', 'Axle Deadlift', 0),
                  candidate('plain', 'Deadlift', 0.5),
                  candidate('barbell', 'Barbell Deadlift', 0.5),
                ]
              : [{ id: 'plain' }, { id: 'barbell' }],
          ),
        );

        const result = await service.list(
          { search: 'deadlift', sort, page: 1, limit: 2 },
          meInstructor,
        );

        expect(exerciseModel.findAndCountAll).not.toHaveBeenCalled();
        expect(result.items.map((row: { id: string }) => row.id)).toEqual([
          'plain',
          'barbell',
        ]);
        expect(result.total).toBe(3);
      },
    );

    it('keeps the asked-for order while searching with sort=newest', async () => {
      exerciseSearch.plan.mockResolvedValueOnce(
        buildSearchPlan('deadlift', taxonomy),
      );

      await service.list(
        { search: 'deadlift', sort: ExerciseSortKey.Newest },
        meInstructor,
      );

      expect(exerciseModel.findAndCountAll).toHaveBeenCalled();
      expect(orderSql()).toContain('createdAt');
    });
  });
  describe('the picture', () => {
    const file = {
      buffer: Buffer.from('x'),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;
    const own = {
      id: 'own-1',
      ownerId: 'me',
      source: ExerciseSource.User,
    };

    it("puts it in the owner's folder and on the exercise", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      exerciseModel.findByPk
        .mockResolvedValueOnce({ ...own, update })
        .mockResolvedValueOnce(own); // reloadDetail

      await service.setImage('own-1', file, meInstructor);

      expect(mediaStorage.uploadImage).toHaveBeenCalledWith(file, {
        resource: 'exercises',
        userId: 'me',
      });
      expect(update).toHaveBeenCalledWith({
        thumbnailUrl:
          'https://img.motionhive.fit/motionhive/test/exercises/me/pic.jpg',
      });
    });

    it('takes it off', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      exerciseModel.findByPk
        .mockResolvedValueOnce({ ...own, update })
        .mockResolvedValueOnce(own);

      await service.removeImage('own-1', meInstructor);

      expect(update).toHaveBeenCalledWith({ thumbnailUrl: null });
    });

    it("never touches ours or someone else's, and uploads nothing then", async () => {
      exerciseModel.findByPk.mockResolvedValueOnce({ ...own, ownerId: 'u-2' });
      await expect(
        service.setImage('own-1', file, meInstructor),
      ).rejects.toThrow(NotFoundException);
      exerciseModel.findByPk.mockResolvedValueOnce({
        ...own,
        ownerId: 'me',
        source: ExerciseSource.System,
      });
      await expect(service.removeImage('own-1', meInstructor)).rejects.toThrow(
        NotFoundException,
      );
      expect(mediaStorage.uploadImage).not.toHaveBeenCalled();
    });
  });
});
