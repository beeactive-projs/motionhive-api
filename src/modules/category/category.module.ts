import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';

/**
 * Category Module
 *
 * MotionHive's list of what people train and why (migration 081), and the
 * check of a pick against it. Imports nothing, so any module can use it:
 * onboarding for a person's and a coach's answers, groups for what a group
 * trains. The SQL that reads the links (`category-sql.ts`) is pure strings
 * and needs no module at all.
 */
@Module({
  imports: [SequelizeModule.forFeature([Category])],
  controllers: [CategoryController],
  providers: [CategoryService],
  exports: [CategoryService],
})
export class CategoryModule {}
