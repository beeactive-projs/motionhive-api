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
import {
  escapeLikeWildcards,
  normalizeSearchTerm,
} from '../../common/utils/search.utils';
import { assertOwned } from '../../common/utils/ownership.utils';
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
    private readonly notificationService: NotificationService,
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
   *   - `mine`          → owner_id = me (any visibility); instructor-only
   *   - `public-others` → visibility=PUBLIC ∧ owner_id ≠ me ∧ source ≠ SYSTEM
   *
   * For client (`USER`) callers, the catalog browse gate is enforced
   * upstream in `assertClientCanBrowse`; here we silently drop the
   * `mine` slice (clients never author exercises).
   */
  async list(filter: ListExercisesQueryDto, principal: PrincipalContext) {
    const where = this.buildListWhere(filter, principal);
    const order = this.buildOrder(
      filter.sort ?? ExerciseSortKey.Name,
      principal.locale,
      filter.search,
    );

    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;

    // Page the exercises alone, then load the includes for that page. The
    // includes are to-many (primary muscles, equipment): paged in one join,
    // LIMIT counted joined rows, so an exercise with two pieces of
    // equipment took two slots and the page came back short. Sequelize's
    // subquery mode would fix that but repeats the ORDER BY outside the
    // subquery, where `search_name` (not a model attribute) is gone. The
    // filters and sorts read "Exercise" columns only (muscle and equipment
    // go through EXISTS), so the id query needs no joins.
    const { rows: pageRows, count } = await this.exerciseModel.findAndCountAll({
      where,
      attributes: ['id'],
      order,
      offset: getOffset(page, limit),
      limit,
    });
    const ids = pageRows.map((row) => row.id);
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
      meta.facets = await this.computeFacets(filter, principal);
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

  async create(dto: CreateExerciseDto, ownerId: string): Promise<Exercise> {
    this.validateMuscleRoles(dto.muscles);
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
          source: ExerciseSource.Instructor,
          ownerId,
          visibility: dto.visibility ?? ExerciseVisibility.Private,
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

      await this.attachMuscles(exercise.id, dto.muscles, tx);
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

    if (dto.muscles) {
      this.validateMuscleRoles(dto.muscles);
    }

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
          ...(dto.visibility !== undefined && { visibility: dto.visibility }),
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
        await this.attachMuscles(exercise.id, dto.muscles, tx);
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
  ): WhereOptions<Exercise> {
    const ownership = filter.ownership ?? ExerciseOwnershipFilter.All;
    const conds: WhereOptions<Exercise>[] = [{ deletedAt: null }];

    // Ownership predicate
    switch (ownership) {
      case ExerciseOwnershipFilter.System:
        conds.push({ source: ExerciseSource.System });
        break;
      case ExerciseOwnershipFilter.Mine:
        if (!principal.isInstructor) {
          // Clients can't have "mine" exercises — return nothing.
          conds.push(literal('1 = 0') as unknown as WhereOptions<Exercise>);
        } else {
          conds.push({ ownerId: principal.userId });
        }
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
          // Clients: SYSTEM OR PUBLIC custom — never PRIVATE.
          conds.push({
            [Op.or]: [
              { source: ExerciseSource.System },
              { visibility: ExerciseVisibility.Public },
            ],
          });
        }
        break;
    }

    const term = this.searchTerm(filter.search);
    if (term) {
      // `search_name` holds the English name and every translated one,
      // lowercased and without diacritics (migration 063), so "squats"
      // finds "Genuflexiuni cu haltera" whatever language the reader is in.
      // A contains match, or a close match (`<%`, word similarity) that
      // forgives plurals and a missing letter.
      const pattern = this.sequelize.escape(`%${escapeLikeWildcards(term)}%`);
      const word = this.sequelize.escape(term);
      conds.push(
        literal(
          `("Exercise".search_name LIKE ${pattern} OR ${word} <% "Exercise".search_name)`,
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

  /** Lowercase, no diacritics, single spaces: matches `search_name`. */
  private searchTerm(search: string | undefined): string {
    return search ? normalizeSearchTerm(search).toLowerCase() : '';
  }

  private buildOrder(
    sort: ExerciseSortKey,
    locale: Locale,
    search: string | undefined,
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
      case ExerciseSortKey.Name:
      default: {
        // While searching, the best match leads: names that contain what
        // was typed, then close matches by how close, then A to Z.
        const term = this.searchTerm(search);
        if (!term) return byName;
        const pattern = this.sequelize.escape(`%${escapeLikeWildcards(term)}%`);
        const word = this.sequelize.escape(term);
        return [
          [literal(`("Exercise".search_name LIKE ${pattern})`), 'DESC'],
          [literal(`word_similarity(${word}, "Exercise".search_name)`), 'DESC'],
          ...byName,
        ];
      }
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
  ) {
    const without = (key: keyof ListExercisesQueryDto) => {
      const next = { ...filter, [key]: undefined } as ListExercisesQueryDto;
      return this.buildListWhere(next, principal);
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

  private validateMuscleRoles(
    muscles: { muscleId: string; role: MuscleRole }[],
  ): void {
    const primaries = muscles.filter((m) => m.role === MuscleRole.Primary);
    if (primaries.length === 0) {
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
