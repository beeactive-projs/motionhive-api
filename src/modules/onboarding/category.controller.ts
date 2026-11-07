import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { OnboardingDocs } from '../../common/docs/onboarding.docs';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';

/**
 * The category list (activities and goals). Open to guests, since the
 * Discover filters a guest sees are made of it.
 */
@ApiTags('Onboarding')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  @Public()
  @ApiEndpoint(OnboardingDocs.listCategories)
  async list(): Promise<Category[]> {
    return this.categoryService.list();
  }
}
