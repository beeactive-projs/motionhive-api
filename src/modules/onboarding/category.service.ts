import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { apiError } from '../../common/i18n';
import { foldText } from '../../common/utils/search.utils';
import { Category } from './entities/category.entity';
import { CategoryKind } from './entities/onboarding.enums';

/** The columns every read sends; `translations` so the reader's language applies. */
const CATEGORY_ATTRIBUTES = [
  'id',
  'slug',
  'kind',
  'name',
  'icon',
  'displayOrder',
  'coachesOnly',
  'translations',
];

/** Who is picking, which decides what they may pick. */
export const CategoryPicker = {
  /** A person's activities: no coaches only ones. */
  Interests: 'INTERESTS',
  /** A person's goals. */
  Goals: 'GOALS',
  /** What a coach coaches: any activity. */
  Coach: 'COACH',
} as const;
export type CategoryPicker =
  (typeof CategoryPicker)[keyof typeof CategoryPicker];

/**
 * The category list: what people train (activities) and why (goals). Read
 * only, MotionHive's own rows (migration 081). Names come out in the
 * reader's language through ContentLocaleInterceptor.
 */
@Injectable()
export class CategoryService {
  constructor(
    @InjectModel(Category) private readonly categoryModel: typeof Category,
  ) {}

  /** The whole list: activities first, each kind in its display order. */
  async list(): Promise<Category[]> {
    return this.categoryModel.findAll({
      attributes: CATEGORY_ATTRIBUTES,
      order: [
        ['kind', 'ASC'],
        ['displayOrder', 'ASC'],
      ],
    });
  }

  /**
   * Checks that every id is a category the picker may choose, and returns
   * the ids of the kind the pick replaces (all activities or all goals), so
   * the caller can swap one kind without touching the other.
   *
   * @throws BadRequestException when an id is unknown, of the other kind,
   *   or coaches only in a person's interests
   */
  async assertPickable(
    picker: CategoryPicker,
    ids: string[],
  ): Promise<{ kindIds: string[] }> {
    let kind: CategoryKind = CategoryKind.Activity;
    if (picker === CategoryPicker.Goals) {
      kind = CategoryKind.Goal;
    }

    const ofKind = await this.categoryModel.findAll({
      where: { kind },
      attributes: ['id', 'coachesOnly'],
    });
    const byId = new Map(ofKind.map((category) => [category.id, category]));

    for (const id of ids) {
      const category = byId.get(id);
      if (!category) {
        throw new BadRequestException(apiError('onboarding.unknownCategory'));
      }
      if (picker === CategoryPicker.Interests && category.coachesOnly) {
        throw new BadRequestException(
          apiError('onboarding.coachesOnlyCategory'),
        );
      }
    }

    return { kindIds: ofKind.map((category) => category.id) };
  }

  /**
   * Every category's name in every language, folded (case and accents
   * aside), so a coach's own word that only repeats one ("yoga", "forta")
   * is not added to their specializations beside the category itself.
   */
  async foldedNames(): Promise<Set<string>> {
    const rows = await this.categoryModel.findAll({
      attributes: ['name', 'translations'],
    });
    const names = new Set<string>();
    for (const row of rows) {
      names.add(foldText(row.name));
      for (const fields of Object.values(row.translations ?? {})) {
        if (fields && typeof fields.name === 'string') {
          names.add(foldText(fields.name));
        }
      }
    }
    return names;
  }
}
