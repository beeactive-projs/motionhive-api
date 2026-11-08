import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';

import { makeModelMock } from '../../../test/helpers/sequelize-mocks';
import { CategoryPicker, CategoryService } from './category.service';
import { Category } from './entities/category.entity';
import { CategoryKind } from './entities/category.enums';

describe('CategoryService.assertPickable', () => {
  const yoga = {
    id: 'cat-yoga',
    kind: CategoryKind.Activity,
    coachesOnly: false,
  };
  const nutrition = {
    id: 'cat-nutrition',
    kind: CategoryKind.Activity,
    coachesOnly: true,
  };
  const loseFat = {
    id: 'cat-lose-fat',
    kind: CategoryKind.Goal,
    coachesOnly: false,
  };

  let service: CategoryService;
  const categoryModel = makeModelMock();

  beforeEach(async () => {
    jest.clearAllMocks();
    // A pick is checked against the categories of its own kind.
    categoryModel.findAll.mockImplementation(
      (options: { where: { kind: CategoryKind } }) =>
        Promise.resolve(
          [yoga, nutrition, loseFat].filter(
            (category) => category.kind === options.where.kind,
          ),
        ),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        CategoryService,
        { provide: getModelToken(Category), useValue: categoryModel },
      ],
    }).compile();
    service = moduleRef.get(CategoryService);
  });

  /** The catalog key a refused pick answers with. */
  const refusal = async (picker: CategoryPicker, ids: string[]) => {
    const error: unknown = await service
      .assertPickable(picker, ids)
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      messageKey: string;
    };
    return body.messageKey;
  };

  it('hands back the ids of the kind being replaced', async () => {
    const { kindIds } = await service.assertPickable(CategoryPicker.Goals, [
      loseFat.id,
    ]);
    expect(kindIds).toEqual([loseFat.id]);
  });

  it('lets a group train any activity, coaches only ones included', async () => {
    await expect(
      service.assertPickable(CategoryPicker.Group, [yoga.id, nutrition.id]),
    ).resolves.toEqual({ kindIds: [yoga.id, nutrition.id] });
    expect(categoryModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: CategoryKind.Activity } }),
    );
  });

  it('refuses a goal or an unknown id for a group', async () => {
    expect(await refusal(CategoryPicker.Group, [loseFat.id])).toBe(
      'category.unknownCategory',
    );
    expect(await refusal(CategoryPicker.Group, ['cat-nope'])).toBe(
      'category.unknownCategory',
    );
  });

  it("keeps coaches only categories out of a person's interests", async () => {
    expect(await refusal(CategoryPicker.Interests, [nutrition.id])).toBe(
      'category.coachesOnlyCategory',
    );
  });
});
