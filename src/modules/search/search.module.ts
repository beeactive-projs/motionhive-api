import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SearchDoc } from './entities/search-doc.entity';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchIndexService } from './search-index.service';
import { RoleModule } from '../role/role.module';

/**
 * Global search.
 *
 * Two services:
 *   - SearchService       — read side. Hits search_doc directly.
 *   - SearchIndexService  — write side. Other modules import this and
 *                           call upsert*() / removeIfExists() in their
 *                           transactions to keep the index fresh.
 *
 * SearchIndexService is exported so the user/profile/group/session
 * modules can wire it as a dependency.
 */
@Module({
  imports: [SequelizeModule.forFeature([SearchDoc]), RoleModule],
  controllers: [SearchController],
  providers: [SearchService, SearchIndexService],
  exports: [SearchIndexService],
})
export class SearchModule {}
