import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CategoryDocs } from '../../common/docs/category.docs';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';

/**
 * The category list (activities and goals). Open to guests, since the
 * Discover filters a guest sees are made of it.
 */
@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  @Public()
  @ApiEndpoint(CategoryDocs.list)
  async list(): Promise<Category[]> {
    return this.categoryService.list();
  }
}
