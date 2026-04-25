import {
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';
import { SearchIndexService } from './search-index.service';

/**
 * Global search.
 *
 * `GET /search?q=&type=&limit=` returns category-grouped results.
 *
 * Auth: required for v1. The recommendations doc suggests opening up
 * to logged-out users for SEO/growth, but visibility filtering against
 * a known viewer is simpler. Revisit once the public-instructor
 * profile pages exist and we want them indexable.
 *
 * Rate limit: 30 req/min per user. Typeahead fires on every debounce
 * tick, so a typing user might hit ~10/min. 30 leaves headroom for
 * tab-switching without flagging legitimate use.
 */
@ApiTags('Search')
@Controller('search')
@UseGuards(AuthGuard('jwt'))
export class SearchController {
  constructor(
    private readonly _searchService: SearchService,
    private readonly _searchIndexService: SearchIndexService,
  ) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async search(
    @Request() req: AuthenticatedRequest,
    @Query() dto: SearchQueryDto,
  ) {
    return this._searchService.search({
      query: dto.q,
      type: dto.type ?? 'all',
      limit: dto.limit ?? 5,
      viewerId: req.user?.id ?? null,
    });
  }

  /**
   * Full reindex of `search_doc` from source tables. Idempotent.
   *
   * Use after deploying the search module for the first time, or to
   * recover from a suspected drift between source entities and the
   * index. SUPER_ADMIN only — this scans every user, instructor,
   * group and non-draft session, which is fine at our scale today
   * but won't be at 100k users.
   *
   * Once the jobs module ships, also wire this as a nightly backstop
   * and remove the `@Throttle` once it's only callable from the
   * scheduler.
   */
  @Post('reindex')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('SUPER_ADMIN')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  async reindex() {
    return this._searchIndexService.reindexAll();
  }
}
