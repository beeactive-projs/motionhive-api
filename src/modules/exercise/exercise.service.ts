import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import {
  Op,
  Order,
  QueryTypes,
  Transaction,
  WhereOptions,
  literal,
} from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { apiError, Locale } from '../../common/i18n';
import { assertOwned } from '../../common/utils/ownership.utils';
import { MediaStorageService } from '../../common/services/media-storage.service';
import {
  buildPaginatedResponse,
  getOffset,
} from '../../common/dto/pagination.dto';
import { NotificationService } from '../notification/notification.service';
import { SearchIndexService } from '../search/search-index.service';
import { User } from '../user/entities/user.entity';
import { Equipment } from './entities/equipment.entity';
import { Exercise } from './entities/exercise.entity';
import { ExerciseEquipment } from './entities/exercise-equipment.entity';
import { ExerciseMedia } from './entities/exercise-media.entity';
import { ExerciseMuscle } from './entities/exercise-muscle.entity';
import { Muscle } from './entities/muscle.entity';
import {
  ExerciseLevel,
  ExerciseSource,
  ExerciseVisibility,
  MuscleRole,
  ExerciseMediaKind,
} from './entities/exercise.enums';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';
import {
  ExerciseOwnershipFilter,
  ExerciseSortKey,
  ListExercisesQueryDto,
} from './dto/list-exercises.query.dto';
import { exerciseForkedForOwner } from './notifications';
import { ExerciseSearchService } from './exercise-search.service';
import {
  ExerciseSearchPlan,
  RANKING_WEIGHTS,
  RankCandidate,
  rankExercises,
  searchWhereSql,
} from './search/exercise-search';
import type { PrincipalContext } from '../../common/decorators/principal.decorator';

interface ListResultMeta {
  facets?: {
    kind?: Record<string, number>;
    primaryMuscleId?: Record<string, number>;
    equipmentId?: Record<string, number>;
    level?: Record<string, number>;
  };
}

const MAX_PRIMARY_MUSCLES = 3;
/** Most matches one search ranks; beyond it only the most used are kept. */
const RANKED_CANDIDATE_CAP = 3000;
const SLUG_MAX = 80;
const SLUG_RETRY_LIMIT = 50;

/**
 * Owner-side fields the FE needs for attribution chips. Single source so
 * `findById`, `reloadDetail` and `buildListIncludes` can't drift.
 */
const EXERCISE_OWNER_ATTRIBUTES = [
  'id',
  'firstName',
  'lastName',
  'avatarUrl',
  'handle',
] as const;

/** The storage folder for exercise pictures, per owner; account erasure deletes it. */
export const EXERCISE_IMAGE_RESOURCE = 'exercises';

@Injectable()
export class ExerciseService {
  constructor(
    @InjectModel(Exercise) private readonly exerciseModel: typeof Exercise,
    @InjectModel(ExerciseMuscle)
    private readonly exerciseMuscleModel: typeof ExerciseMuscle,
    @InjectModel(ExerciseEquipment)
    private readonly exerciseEquipmentModel: typeof ExerciseEquipment,
    @InjectModel(ExerciseMedia)
    private readonly exerciseMediaModel: typeof ExerciseMedia,
    @InjectModel(Muscle) private readonly muscleModel: typeof Muscle,
    @InjectModel(Equipment) private readonly equipmentModel: typeof Equipment,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly searchIndex: SearchIndexService,
    private readonly exerciseSearch: ExerciseSearchService,
    private readonly notificationService: NotificationService,
    private readonly mediaStorage: MediaStorageService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Taxonomy (small, cached at the FE; just sorted-by-display-order reads)
  // ────────────────────────────────────────────────────────────────────

  async listMuscles(): Promise<Muscle[]> {
    return this.muscleModel.findAll({
      order: [
        ['displayOrder', 'ASC'],
        ['commonName', 'ASC'],
      ],
    });
  }

  async listEquipment(): Promise<Equipment[]> {
    return this.equipmentModel.findAll({
      order: [
        ['displayOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // List + facets
  // ────────────────────────────────────────────────────────────────────

  /**
   * Paginated list. Visibility scoping baked into the WHERE — never
   * served from a client-side filter.
   *
   * Ownership filter semantics:
   *   - `all`           → SYSTEM ∪ mine ∪ public-from-others
   *   - `system`        → SYSTEM only
   *   - `mine`          → owner_id = me (any visibility), for every role:
   *                       someone who is not a coach owns the exercises
   *                       they made (source USER, always PRIVATE)
   *   - `public-others` → visibility=PUBLIC ∧ owner_id ≠ me ∧ source ≠ SYSTEM
   *
   * For client (`USER`) callers, the catalog browse gate is enforced
   * upstream in `assertClientCanBrowse`.
   */
  async list(filter: ListExercisesQueryDto, principal: PrincipalContext) {
    const sort = filter.sort ?? ExerciseSortKey.Relevance;
    const plan = await this.exerciseSearch.plan(filter.search);
    const where = this.buildListWhere(filter, principal, plan);

    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;

    // Page the exercises alone, then load the includes for that page. The
    // includes are to-many (primary muscles, equipment): paged in one join,
    // LIMIT counted joined rows, so an exercise with two pieces of
    // equipment took two slots and the page came back short. The filters
    // and sorts read "Exercise" columns only (muscle and equipment go
    // through EXISTS), so the id query needs no joins.
    const { ids, count } =
      plan &&
      (sort === ExerciseSortKey.Relevance || sort === ExerciseSortKey.Name)
        ? await this.rankedPage(where, plan, principal, page, limit)
        : await this.orderedPage(where, sort, principal, page, limit);
    const loaded = ids.length
      ? await this.exerciseModel.findAll({
          where: { id: { [Op.in]: ids } },
          include: this.buildListIncludes(),
        })
      : [];
    const byId = new Map(loaded.map((row) => [row.id, row]));
    const rows = ids
      .map((id) => byId.get(id))
      .filter((row): row is Exercise => row !== undefined);

    const meta: ListResultMeta = {};
    if (filter.withFacets) {
      meta.facets = await this.computeFacets(filter, principal, plan);
    }

    return {
      ...buildPaginatedResponse(rows, count, page, limit),
      ...meta,
    };
  }

  /**
   * Detail view. Loads owner identity, fork lineage, media overlay,
   * muscle roles, and equipment. Same shape for instructor and client
   * callers; the controller layer gates write actions.
   */
  async findById(id: string, principal: PrincipalContext): Promise<Exercise> {
    const exercise = await this.exerciseModel.findByPk(id, {
      include: this.detailIncludes(),
    });

    if (!exercise) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }

    if (!this.canRead(exercise, principal)) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }

    return exercise;
  }

  // ────────────────────────────────────────────────────────────────────
  // Create
  // ────────────────────────────────────────────────────────────────────

  /**
   * @param isInstructor a coach authors an INSTRUCTOR exercise, PRIVATE or
   * PUBLIC, with at least one primary muscle. Anyone else authors a USER
   * one for their own training: always PRIVATE, muscles optional (the
   * form's chips). Ownership is the boundary either way.
   */
  async create(
    dto: CreateExerciseDto,
    ownerId: string,
    isInstructor = true,
  ): Promise<Exercise> {
    const muscles = dto.muscles ?? [];
    this.validateMuscleRoles(muscles, { requirePrimary: isInstructor });
    const slug = await this.allocateSlug(dto.name, ownerId);

    const created = await this.sequelize.transaction(async (tx) => {
      const exercise = await this.exerciseModel.create(
        {
          name: dto.name.trim(),
          slug,
          description: dto.description?.trim() || null,
          instructions: dto.instructions?.trim() || null,
          kind: dto.kind,
          level: dto.level ?? ExerciseLevel.Beginner,
          movementPattern: dto.movementPattern ?? null,
          mechanic: dto.mechanic ?? null,
          force: dto.force ?? null,
          metValue: dto.metValue ?? null,
          isUnilateral: dto.isUnilateral ?? false,
          source: isInstructor
            ? ExerciseSource.Instructor
            : ExerciseSource.User,
          ownerId,
          // A USER exercise is private by rule (a CHECK backs it).
          visibility: isInstructor
            ? (dto.visibility ?? ExerciseVisibility.Private)
            : ExerciseVisibility.Private,
          forkedFromId: null,
          mediaKind: dto.youtubeUrl
            ? ExerciseMediaKind.Youtube
            : ExerciseMediaKind.None,
          thumbnailUrl: null,
          youtubeUrl: dto.youtubeUrl ?? null,
          forkCount: 0,
        },
        { transaction: tx },
      );

      if (muscles.length) {
        await this.attachMuscles(exercise.id, muscles, tx);
      }
      if (dto.equipmentIds?.length) {
        await this.attachEquipment(exercise.id, dto.equipmentIds, tx);
      }

      return exercise;
    });

    // notify-after-commit + search-index-after-commit (best-effort).
    await this.indexExercise(created.id, 'create');
    return this.reloadDetail(created.id);
  }

  // ────────────────────────────────────────────────────────────────────
  // Update
  // ────────────────────────────────────────────────────────────────────

  async update(
    id: string,
    dto: UpdateExerciseDto,
    principal: PrincipalContext,
  ): Promise<Exercise> {
    const exercise = await this.exerciseModel.findByPk(id);
    // SYSTEM rows have ownerId=NULL, so assertOwned already throws (hide).
    // We still gate via assertOwned for any future custom rows with NULL
    // owner_id (none today, but the check is the single source of truth).
    assertOwned(exercise, principal.userId, (e) => e.ownerId, {
      notFoundMessage: apiError('exercise.notFound'),
      onMismatch: 'hide',
    });
    if (exercise.source === ExerciseSource.System) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }

    // Someone's own (USER) exercise: muscles optional, and it stays
    // PRIVATE whatever is sent, since a CHECK refuses anything else.
    const isUserOwn = exercise.source === ExerciseSource.User;
    if (dto.muscles) {
      this.validateMuscleRoles(dto.muscles, { requirePrimary: !isUserOwn });
    }
    const visibility = isUserOwn ? undefined : dto.visibility;

    let slug = exercise.slug;
    if (dto.name && dto.name.trim() !== exercise.name) {
      slug = await this.allocateSlug(dto.name, exercise.ownerId, exercise.id);
    }

    await this.sequelize.transaction(async (tx) => {
      await exercise.update(
        {
          ...(dto.name !== undefined && { name: dto.name.trim(), slug }),
          ...(dto.description !== undefined && {
            description: dto.description?.trim() || null,
          }),
          ...(dto.instructions !== undefined && {
            instructions: dto.instructions?.trim() || null,
          }),
          ...(dto.kind !== undefined && { kind: dto.kind }),
          ...(dto.level !== undefined && { level: dto.level }),
          ...(dto.movementPattern !== undefined && {
            movementPattern: dto.movementPattern,
          }),
          ...(dto.mechanic !== undefined && { mechanic: dto.mechanic }),
          ...(dto.force !== undefined && { force: dto.force }),
          ...(dto.metValue !== undefined && { metValue: dto.metValue }),
          ...(dto.isUnilateral !== undefined && {
            isUnilateral: dto.isUnilateral,
          }),
          ...(visibility !== undefined && { visibility }),
          ...(dto.youtubeUrl !== undefined && {
            youtubeUrl: dto.youtubeUrl || null,
            mediaKind: dto.youtubeUrl
              ? ExerciseMediaKind.Youtube
              : ExerciseMediaKind.None,
          }),
        },
        { transaction: tx },
      );

      if (dto.muscles) {
        await this.exerciseMuscleModel.destroy({
          where: { exerciseId: exercise.id },
          transaction: tx,
        });
        if (dto.muscles.length) {
          await this.attachMuscles(exercise.id, dto.muscles, tx);
        }
      }

      if (dto.equipmentIds) {
        await this.exerciseEquipmentModel.destroy({
          where: { exerciseId: exercise.id },
          transaction: tx,
        });
        if (dto.equipmentIds.length) {
          await this.attachEquipment(exercise.id, dto.equipmentIds, tx);
        }
      }
    });

    await this.indexExercise(exercise.id, 'update');
    return this.reloadDetail(exercise.id);
  }

  // ────────────────────────────────────────────────────────────────────
  // Picture (own and coaches' exercises)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Sets the exercise's picture: a public image in the owner's
   * folder, shown wherever the exercise is (list, picker, logger). Public on
   * purpose: a coach's exercise is seen by their clients, and the link is
   * not guessable. Account erasure deletes the folder.
   *
   * The picture it replaces stays stored: workouts logged with it keep its
   * link (`exercise_thumbnail_url_snapshot`) and still show it.
   */
  async setImage(
    id: string,
    file: Express.Multer.File,
    principal: PrincipalContext,
  ): Promise<Exercise> {
    const exercise = await this.ownedCustom(id, principal);
    const { url } = await this.mediaStorage.uploadImage(file, {
      resource: EXERCISE_IMAGE_RESOURCE,
      userId: principal.userId,
    });
    await exercise.update({ thumbnailUrl: url });
    return this.reloadDetail(exercise.id);
  }

  /** Takes the picture off; the exercise shows its kind's tile again. */
  async removeImage(
    id: string,
    principal: PrincipalContext,
  ): Promise<Exercise> {
    const exercise = await this.ownedCustom(id, principal);
    await exercise.update({ thumbnailUrl: null });
    return this.reloadDetail(exercise.id);
  }

  /** The caller's own (USER or coach-made) exercise; ours and others' read as not found. */
  private async ownedCustom(
    id: string,
    principal: PrincipalContext,
  ): Promise<Exercise> {
    const exercise = await this.exerciseModel.findByPk(id);
    assertOwned(exercise, principal.userId, (e) => e.ownerId, {
      notFoundMessage: apiError('exercise.notFound'),
      onMismatch: 'hide',
    });
    if (exercise.source === ExerciseSource.System) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }
    return exercise;
  }

  // ────────────────────────────────────────────────────────────────────
  // Soft delete (paranoid)
  // ────────────────────────────────────────────────────────────────────

  async softDelete(id: string, principal: PrincipalContext): Promise<void> {
    const exercise = await this.exerciseModel.findByPk(id);
    assertOwned(exercise, principal.userId, (e) => e.ownerId, {
      notFoundMessage: apiError('exercise.notFound'),
      onMismatch: 'hide',
    });
    if (exercise.source === ExerciseSource.System) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }

    // Hard-delete is blocked by ON DELETE RESTRICT on prescribed/assigned/
    // logged_exercise. Sequelize paranoid soft-delete is always safe.
    await this.sequelize.transaction(async (tx) => {
      await exercise.destroy({ transaction: tx });

      // If this was a fork, decrement the source's fork_count.
      if (exercise.forkedFromId) {
        await this.exerciseModel.increment(
          { forkCount: -1 },
          {
            where: {
              id: exercise.forkedFromId,
              forkCount: { [Op.gt]: 0 },
            },
            transaction: tx,
          },
        );
      }
    });

    await this.removeFromIndex(exercise.id);
  }

  // ────────────────────────────────────────────────────────────────────
  // Fork (clone PUBLIC exercise into my PRIVATE library)
  // ────────────────────────────────────────────────────────────────────

  async fork(sourceId: string, principal: PrincipalContext): Promise<Exercise> {
    const source = await this.exerciseModel.findByPk(sourceId, {
      include: [
        { model: ExerciseMuscle, as: 'muscleRoles' },
        { association: 'equipment' },
      ],
    });

    if (!source) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }
    if (source.visibility !== ExerciseVisibility.Public) {
      // Hide existence — a public exercise was made private after
      // someone tapped Fork; don't leak that it still exists.
      throw new NotFoundException(apiError('exercise.notFound'));
    }
    if (source.ownerId === principal.userId) {
      throw new BadRequestException(apiError('exercise.cannotForkOwn'));
    }

    // Locked decision §17 anti-spam: one live fork per (owner, source).
    // Defense-in-depth — DB has a partial UNIQUE index (migration 048)
    // that turns concurrent racers into a unique-constraint violation;
    // this service-side check returns the friendlier 409 first.
    const existingFork = await this.exerciseModel.findOne({
      where: {
        ownerId: principal.userId,
        forkedFromId: source.id,
      },
      attributes: ['id'],
    });
    if (existingFork) {
      throw new ConflictException(apiError('exercise.alreadyForked'));
    }

    const slug = await this.allocateSlug(source.name, principal.userId);

    const fork = await this.sequelize.transaction(async (tx) => {
      const cloned = await this.exerciseModel.create(
        {
          name: source.name,
          slug,
          description: source.description,
          instructions: source.instructions,
          kind: source.kind,
          level: source.level,
          movementPattern: source.movementPattern,
          mechanic: source.mechanic,
          force: source.force,
          metValue: source.metValue,
          isUnilateral: source.isUnilateral,
          source: ExerciseSource.Instructor,
          ownerId: principal.userId,
          visibility: ExerciseVisibility.Private,
          forkedFromId: source.id,
          mediaKind: source.mediaKind,
          thumbnailUrl: source.thumbnailUrl,
          youtubeUrl: source.youtubeUrl,
          forkCount: 0,
        },
        { transaction: tx },
      );

      const muscleRows = (source.muscleRoles ?? []).map((m) => ({
        exerciseId: cloned.id,
        muscleId: m.muscleId,
        role: m.role,
      }));
      if (muscleRows.length) {
        await this.exerciseMuscleModel.bulkCreate(muscleRows, {
          transaction: tx,
        });
      }

      const equipmentRows = (source.equipment ?? []).map((e) => ({
        exerciseId: cloned.id,
        equipmentId: e.id,
      }));
      if (equipmentRows.length) {
        await this.exerciseEquipmentModel.bulkCreate(equipmentRows, {
          transaction: tx,
        });
      }

      // §17: maintain fork_count inside the same tx.
      await this.exerciseModel.increment(
        { forkCount: 1 },
        { where: { id: source.id }, transaction: tx },
      );

      return cloned;
    });

    // Re-read the authoritative counter post-commit (the local source.forkCount
    // is now stale and would lie in the notification under concurrent forks).
    const updatedCount = await this.exerciseModel.findByPk(source.id, {
      attributes: ['forkCount'],
    });
    const newForkCount = updatedCount?.forkCount ?? source.forkCount + 1;

    // notify-after-commit (best effort — failure here doesn't roll the fork back).
    await this.notifyOwnerOfFork(source, principal, newForkCount);
    await this.indexExercise(fork.id, 'fork');

    return this.reloadDetail(fork.id);
  }

  // ────────────────────────────────────────────────────────────────────
  // Client browse gate (Locked Decision §19)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Catalog browsing is open to any signed-in user. The original gate
   * (opt-in OR an existing program assignment) made sense back when
   * the only client surface was "see what your coach assigned" — a
   * focus aid. With freestyle workouts now a primary surface, anyone
   * starting a session needs the catalog, so a hard 403 here just
   * dead-ends the freestyle flow. Visibility of private custom
   * exercises authored by *other* users is still enforced by the
   * `visibility` column on each row (`buildListWhere`).
   *
   * The `exerciseCatalogOptIn` field stays on the user model (no
   * migration churn); it can come back as a soft "filter to my coach's
   * picks" preference later if that turns out to be a real user need.
   *
   * @returns always `true` — kept for call-site compatibility.
   */
  canClientBrowseCatalog(_principal: PrincipalContext): Promise<boolean> {
    return Promise.resolve(true);
  }

  /**
   * Kept for call-site compatibility — currently a no-op. See
   * `canClientBrowseCatalog` for why the gate was lifted.
   */
  assertClientCanBrowse(_principal: PrincipalContext): Promise<void> {
    return Promise.resolve();
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private buildListWhere(
    filter: ListExercisesQueryDto,
    principal: PrincipalContext,
    plan: ExerciseSearchPlan | null,
  ): WhereOptions<Exercise> {
    const ownership = filter.ownership ?? ExerciseOwnershipFilter.All;
    const conds: WhereOptions<Exercise>[] = [{ deletedAt: null }];

    // Ownership predicate
    switch (ownership) {
      case ExerciseOwnershipFilter.System:
        conds.push({ source: ExerciseSource.System });
        break;
      case ExerciseOwnershipFilter.Mine:
        // Everyone can own exercises: a coach's, or the USER ones someone
        // made for their own training.
        conds.push({ ownerId: principal.userId });
        break;
      case ExerciseOwnershipFilter.PublicOthers:
        conds.push({
          visibility: ExerciseVisibility.Public,
          source: { [Op.ne]: ExerciseSource.System },
          ownerId: { [Op.ne]: principal.userId },
        });
        break;
      case ExerciseOwnershipFilter.All:
      default:
        if (principal.isInstructor) {
          // SYSTEM OR mine OR public-from-others
          conds.push({
            [Op.or]: [
              { source: ExerciseSource.System },
              { ownerId: principal.userId },
              {
                visibility: ExerciseVisibility.Public,
                ownerId: { [Op.ne]: principal.userId },
              },
            ],
          });
        } else {
          // Clients: SYSTEM, PUBLIC custom, and their own (always
          // PRIVATE). Never someone else's PRIVATE row.
          conds.push({
            [Op.or]: [
              { source: ExerciseSource.System },
              { visibility: ExerciseVisibility.Public },
              { ownerId: principal.userId },
            ],
          });
        }
        break;
    }

    if (plan) {
      // Words of any of the names (`search_name` holds every language,
      // migrations 063 and 080), muscles, equipment, shorthand: see
      // `search/exercise-search.ts`.
      conds.push(
        literal(
          searchWhereSql(plan, (value) => this.sequelize.escape(value)),
        ) as unknown as WhereOptions<Exercise>,
      );
    }
    if (filter.kind?.length) conds.push({ kind: { [Op.in]: filter.kind } });
    if (filter.level?.length) conds.push({ level: { [Op.in]: filter.level } });
    if (filter.movementPattern?.length) {
      conds.push({ movementPattern: { [Op.in]: filter.movementPattern } });
    }
    if (filter.mechanic?.length) {
      conds.push({ mechanic: { [Op.in]: filter.mechanic } });
    }
    if (filter.force?.length) {
      conds.push({ force: { [Op.in]: filter.force } });
    }

    // Muscle / equipment filters need EXISTS-style subqueries — Sequelize's
    // include-with-where forces a JOIN that distorts pagination. Raw subquery
    // via `literal` is the surgical option.
    // Muscle / equipment filters use EXISTS subqueries — Sequelize's
    // include-with-where forces a JOIN that distorts pagination counts.
    // IDs are validated as UUID v4 by the DTO and additionally escaped
    // via `sequelize.escape()` (defense in depth) before the literal.
    if (filter.primaryMuscleId?.length) {
      const ids = filter.primaryMuscleId
        .map((id) => this.sequelize.escape(id))
        .join(',');
      conds.push({
        [Op.and]: literal(
          `EXISTS (SELECT 1 FROM exercise_muscle em WHERE em.exercise_id = "Exercise".id AND em.role = 'PRIMARY' AND em.muscle_id IN (${ids}))`,
        ),
      } as WhereOptions<Exercise>);
    }
    if (filter.equipmentId?.length) {
      const ids = filter.equipmentId
        .map((id) => this.sequelize.escape(id))
        .join(',');
      conds.push({
        [Op.and]: literal(
          `EXISTS (SELECT 1 FROM exercise_equipment ee WHERE ee.exercise_id = "Exercise".id AND ee.equipment_id IN (${ids}))`,
        ),
      } as WhereOptions<Exercise>);
    }

    return { [Op.and]: conds };
  }

  /**
   * One page of a search, best match first. Every match is scored in code
   * (`rankExercises`): how well the words matched, how much the exercise is
   * the searcher's own, how much everyone uses it. A search matches a small
   * slice of the library, so reading all of its matches is cheap; past
   * `RANKED_CANDIDATE_CAP` (a query of a letter or two in a huge library)
   * only the most used ones are ranked.
   */
  private async rankedPage(
    where: WhereOptions<Exercise>,
    plan: ExerciseSearchPlan,
    principal: PrincipalContext,
    page: number,
    limit: number,
  ): Promise<{ ids: string[]; count: number }> {
    const locale = this.sequelize.escape(principal.locale);
    const [candidates, personal] = await Promise.all([
      this.exerciseModel.findAll({
        where,
        attributes: [
          'id',
          'name',
          [
            literal(
              `COALESCE("Exercise".translations -> ${locale} ->> 'name', "Exercise".name)`,
            ),
            'localeName',
          ],
          [literal('"Exercise".search_name'), 'searchName'],
          [literal('"Exercise".popularity_score'), 'popularity'],
          [
            literal(
              `ARRAY(SELECT em.muscle_id::text FROM exercise_muscle em WHERE em.exercise_id = "Exercise".id AND em.role = 'PRIMARY')`,
            ),
            'primaryMuscleIds',
          ],
          [
            literal(
              `ARRAY(SELECT em.muscle_id::text FROM exercise_muscle em WHERE em.exercise_id = "Exercise".id AND em.role = 'SECONDARY')`,
            ),
            'secondaryMuscleIds',
          ],
          [
            literal(
              `ARRAY(SELECT ee.equipment_id::text FROM exercise_equipment ee WHERE ee.exercise_id = "Exercise".id)`,
            ),
            'equipmentIds',
          ],
        ],
        order: [
          [literal('"Exercise".popularity_score'), 'DESC'],
          ['id', 'ASC'],
        ],
        limit: RANKED_CANDIDATE_CAP,
        raw: true,
      }) as unknown as Promise<RankCandidate[]>,
      this.exerciseSearch.personalScores(principal.userId),
    ]);

    const ranked = rankExercises(
      plan,
      candidates.map((row) => ({
        ...row,
        popularity: Number(row.popularity) || 0,
      })),
      personal,
    );
    const offset = getOffset(page, limit);
    return { ids: ranked.slice(offset, offset + limit), count: ranked.length };
  }

  /** One page in a fixed order, paged by the database. */
  private async orderedPage(
    where: WhereOptions<Exercise>,
    sort: ExerciseSortKey,
    principal: PrincipalContext,
    page: number,
    limit: number,
  ): Promise<{ ids: string[]; count: number }> {
    const personal =
      sort === ExerciseSortKey.Relevance
        ? await this.exerciseSearch.personalScores(principal.userId)
        : null;
    const { rows, count } = await this.exerciseModel.findAndCountAll({
      where,
      attributes: ['id'],
      order: this.buildOrder(sort, principal.locale, personal),
      offset: getOffset(page, limit),
      limit,
    });
    return { ids: rows.map((row) => row.id), count };
  }

  private buildOrder(
    sort: ExerciseSortKey,
    locale: Locale,
    personal: ReadonlyMap<string, number> | null,
  ): Order {
    // The name the reader sees, folded, so Romanian names sort where a
    // Romanian expects them ("Împins" with the I's, not after Z).
    const byName: Order = [
      [
        literal(
          `fold_for_search(COALESCE("Exercise".translations -> ${this.sequelize.escape(locale)} ->> 'name', "Exercise".name))`,
        ),
        'ASC',
      ],
      ['id', 'ASC'],
    ];
    switch (sort) {
      case ExerciseSortKey.Newest:
        return [['createdAt', 'DESC']];
      case ExerciseSortKey.MostForked:
        // `idx_exercise_fork_count` is partial (visibility='PUBLIC'); a sort
        // applied to a non-public-filtered scan still works but the planner
        // falls back to a seq scan. Acceptable — list queries always pair
        // this sort with `ownership='public-others'` from the UI.
        return [['forkCount', 'DESC'], ...byName];
      case ExerciseSortKey.Relevance: {
        // Nothing typed: what this person and everyone use most, the same
        // weights as a search's ranking. The person's scores ride along as
        // one escaped JSON object keyed by exercise id.
        const mine = this.sequelize.escape(
          JSON.stringify(Object.fromEntries(personal ?? [])),
        );
        return [
          [
            literal(
              `(${RANKING_WEIGHTS.personal} * COALESCE((${mine}::jsonb ->> "Exercise".id::text)::real, 0) + ${RANKING_WEIGHTS.popularity} * "Exercise".popularity_score)`,
            ),
            'DESC',
          ],
          ...byName,
        ];
      }
      case ExerciseSortKey.Name:
      default:
        return byName;
    }
  }

  private detailIncludes() {
    return [
      {
        model: User,
        as: 'owner',
        attributes: [...EXERCISE_OWNER_ATTRIBUTES],
      },
      {
        model: Exercise,
        as: 'forkedFrom',
        attributes: ['id', 'name', 'slug'],
      },
      { model: ExerciseMedia, as: 'media' },
      { model: ExerciseMuscle, as: 'muscleRoles', include: [Muscle] },
      { model: Equipment, as: 'equipment' },
    ];
  }

  private buildListIncludes() {
    return [
      {
        model: User,
        as: 'owner',
        attributes: [...EXERCISE_OWNER_ATTRIBUTES],
        required: false,
      },
      {
        model: ExerciseMuscle,
        as: 'muscleRoles',
        where: { role: MuscleRole.Primary },
        required: false,
        include: [Muscle],
      },
      { model: Equipment, as: 'equipment', required: false },
    ];
  }

  /**
   * Per-facet aggregate counts, each respecting all OTHER filters but
   * NOT the facet being counted (classic ecommerce facet semantics).
   * Four small GROUP BYs in parallel; cheap enough that we don't
   * complicate with caching yet.
   */
  private async computeFacets(
    filter: ListExercisesQueryDto,
    principal: PrincipalContext,
    plan: ExerciseSearchPlan | null,
  ) {
    const without = (key: keyof ListExercisesQueryDto) => {
      const next = { ...filter, [key]: undefined } as ListExercisesQueryDto;
      return this.buildListWhere(next, principal, plan);
    };

    const [kindRows, muscleRows, equipmentRows, levelRows] = await Promise.all([
      this.exerciseModel.findAll({
        attributes: [
          'kind',
          [
            this.sequelize.fn('COUNT', this.sequelize.col('Exercise.id')),
            'count',
          ],
        ],
        where: without('kind'),
        group: ['kind'],
        raw: true,
      }) as unknown as Promise<Array<{ kind: string; count: string }>>,
      this.sequelize.query<{ muscle_id: string; count: string }>(
        `SELECT em.muscle_id, COUNT(DISTINCT e.id) AS count
           FROM exercise e
           JOIN exercise_muscle em ON em.exercise_id = e.id AND em.role = 'PRIMARY'
          WHERE e.deleted_at IS NULL
          GROUP BY em.muscle_id`,
        { type: QueryTypes.SELECT },
      ),
      this.sequelize.query<{ equipment_id: string; count: string }>(
        `SELECT ee.equipment_id, COUNT(DISTINCT e.id) AS count
           FROM exercise e
           JOIN exercise_equipment ee ON ee.exercise_id = e.id
          WHERE e.deleted_at IS NULL
          GROUP BY ee.equipment_id`,
        { type: QueryTypes.SELECT },
      ),
      this.exerciseModel.findAll({
        attributes: [
          'level',
          [
            this.sequelize.fn('COUNT', this.sequelize.col('Exercise.id')),
            'count',
          ],
        ],
        where: without('level'),
        group: ['level'],
        raw: true,
      }) as unknown as Promise<Array<{ level: string; count: string }>>,
    ]);

    const toMap = <K extends string>(
      rows: Array<Record<K, string> & { count: string }>,
      key: K,
    ) => {
      const m: Record<string, number> = {};
      for (const r of rows) m[r[key]] = Number(r.count);
      return m;
    };

    return {
      kind: toMap(kindRows as Array<{ kind: string; count: string }>, 'kind'),
      primaryMuscleId: toMap(
        muscleRows as Array<{ muscle_id: string; count: string }>,
        'muscle_id',
      ),
      equipmentId: toMap(
        equipmentRows as Array<{ equipment_id: string; count: string }>,
        'equipment_id',
      ),
      level: toMap(
        levelRows as Array<{ level: string; count: string }>,
        'level',
      ),
    };
  }

  private canRead(exercise: Exercise, principal: PrincipalContext): boolean {
    if (exercise.source === ExerciseSource.System) return true;
    if (exercise.visibility === ExerciseVisibility.Public) return true;
    return exercise.ownerId === principal.userId;
  }

  /**
   * `requirePrimary`: a coach's exercise names at least one primary
   * muscle; someone's own (USER) one may have none, since the form's
   * muscle chips are optional.
   */
  private validateMuscleRoles(
    muscles: { muscleId: string; role: MuscleRole }[],
    { requirePrimary = true }: { requirePrimary?: boolean } = {},
  ): void {
    const primaries = muscles.filter((m) => m.role === MuscleRole.Primary);
    if (requirePrimary && primaries.length === 0) {
      throw new BadRequestException(apiError('exercise.primaryMuscleRequired'));
    }
    if (primaries.length > MAX_PRIMARY_MUSCLES) {
      throw new BadRequestException(
        apiError('exercise.tooManyPrimaryMuscles', {
          max: MAX_PRIMARY_MUSCLES,
        }),
      );
    }
    const seen = new Set<string>();
    for (const m of muscles) {
      const key = `${m.muscleId}:${m.role}`;
      if (seen.has(key)) {
        throw new BadRequestException(apiError('exercise.duplicateMuscle'));
      }
      seen.add(key);
    }
  }

  private async attachMuscles(
    exerciseId: string,
    muscles: { muscleId: string; role: MuscleRole }[],
    tx: Transaction,
  ) {
    await this.exerciseMuscleModel.bulkCreate(
      muscles.map((m) => ({
        exerciseId,
        muscleId: m.muscleId,
        role: m.role,
      })),
      { transaction: tx },
    );
  }

  private async attachEquipment(
    exerciseId: string,
    equipmentIds: string[],
    tx: Transaction,
  ) {
    const unique = Array.from(new Set(equipmentIds));
    await this.exerciseEquipmentModel.bulkCreate(
      unique.map((equipmentId) => ({ exerciseId, equipmentId })),
      { transaction: tx },
    );
  }

  /**
   * NFD-strip-diacritics + kebab-case. Owner-scoped uniqueness — the
   * `excludeId` lets `update()` keep its own slug. SYSTEM (owner=null)
   * shares the NULL bucket; conflicts collapse there too.
   */
  private async allocateSlug(
    name: string,
    ownerId: string | null,
    excludeId?: string,
  ): Promise<string> {
    const base =
      name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // strip combining diacritics
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, SLUG_MAX) || 'exercise';

    for (let n = 0; n < SLUG_RETRY_LIMIT; n++) {
      const candidate = n === 0 ? base : `${base}-${n + 1}`;
      // paranoid mode (default true) — matches the partial unique index
      // in migration 047 which excludes deleted rows.
      const conflict = await this.exerciseModel.findOne({
        where: {
          slug: candidate,
          ownerId,
          ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
        },
      });
      if (!conflict) return candidate;
    }
    throw new BadRequestException(apiError('exercise.tooManyWithName'));
  }

  private async reloadDetail(id: string): Promise<Exercise> {
    const reloaded = await this.exerciseModel.findByPk(id, {
      include: this.detailIncludes(),
    });
    if (!reloaded) {
      // Should not happen — we just wrote it. Surface as 500 via a generic throw.
      throw new NotFoundException(apiError('exercise.notFound'));
    }
    return reloaded;
  }

  private async indexExercise(
    id: string,
    op: 'create' | 'update' | 'fork',
  ): Promise<void> {
    try {
      await this.searchIndex.upsertExercise(id);
    } catch (err) {
      // Index drift is preferable to rolling back the source-of-truth write.
      this.logger.warn(
        `Search index ${op} failed for exercise ${id}: ${(err as Error).message}`,
        'ExerciseService',
      );
    }
  }

  private async removeFromIndex(id: string): Promise<void> {
    try {
      await this.searchIndex.removeIfExists('exercise', id);
    } catch (err) {
      this.logger.warn(
        `Search index remove failed for exercise ${id}: ${(err as Error).message}`,
        'ExerciseService',
      );
    }
  }

  private async notifyOwnerOfFork(
    source: Exercise,
    principal: PrincipalContext,
    newForkCount: number,
  ): Promise<void> {
    if (!source.ownerId) return; // SYSTEM exercises can't be forked anyway
    try {
      await this.notificationService.notify(
        exerciseForkedForOwner({
          ownerId: source.ownerId,
          exerciseId: source.id,
          exerciseName: source.name,
          forkedByName: principal.displayName ?? 'Another instructor',
          newForkCount,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `EXERCISE_FORKED notification failed for ${source.id}: ${(err as Error).message}`,
        'ExerciseService',
      );
    }
  }
}
