import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { Op, fn, col, WhereOptions } from 'sequelize';
import { BlogPost } from './entities/blog-post.entity';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { BlogQueryDto } from './dto/blog-query.dto';
import { User, USER_SAFE_ATTRIBUTES } from '../user/entities/user.entity';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import {
  buildPaginatedResponse,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { buildSearchTerm } from '../../common/utils/search.utils';
import { escapeHtml } from '../../common/utils/html.utils';
import { apiError } from '../../common/i18n';

interface AuthContext {
  userId: string;
  roles: string[];
}

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

/**
 * Website path prefix per post language. English is the default locale
 * and lives at the root; Romanian is the `/ro` bundle (see the website's
 * vercel.json). A language missing here is skipped from the sitemap.
 */
const SITEMAP_LOCALE_PREFIX: Record<string, string> = { en: '', ro: '/ro' };
const SITEMAP_DEFAULT_LANGUAGE = 'en';

/** A slug that forms one clean path segment: no whitespace, `/`, `?`, `#`. */
const SITEMAP_SLUG_PATTERN = /^[^\s/?#\\]+$/;

/**
 * The public post lookup: published, stored slug and language matched
 * exactly (no trimming or case folding). `findBySlug` serves from it and
 * the sitemap lists from it, so the sitemap can't advertise a URL that
 * 404s, e.g. the trimmed form of a legacy slug stored with a leading space.
 */
const publicPostWhere = (
  slug: string,
  language: string,
): WhereOptions<BlogPost> => ({ slug, language, isPublished: true });

/**
 * Public blog post response. Storage is `authorUserId` (FK) XOR
 * `guestAuthorName` (string). `authorName` / `authorInitials` /
 * `authorAvatarUrl` are computed at read time from the user join
 * (or from `guestAuthorName` for guest contributors).
 */
export interface BlogPostResponse {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content?: string;
  category: string;
  coverImage: string | null;
  authorUserId: string | null;
  guestAuthorName: string | null;
  /** Computed: user.firstName + lastName, or guestAuthorName. */
  authorName: string;
  /** Computed: first letter of first + last name. */
  authorInitials: string;
  /**
   * Cloudinary URL of the registered author's profile picture, when
   * present. Null for guest-authored posts (no user join) and for
   * registered authors who haven't uploaded an avatar. The FE falls
   * back to the initials circle when this is null.
   */
  authorAvatarUrl: string | null;
  /**
   * URL handle of the registered author, when they have one. Null for
   * guest-authored posts (no user join) and for registered authors who
   * haven't been assigned a handle. The public website turns the byline
   * into a link to the author's `/@<handle>` profile when this is set,
   * and to the signup page otherwise (our own "MotionHive Editors"
   * content has no handle).
   */
  authorHandle: string | null;
  readTime: number;
  tags: string[] | null;
  language: string;
  isPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  // Process-local sitemap cache. Regenerated at most once per hour.
  // Prevents an attacker from forcing a fresh 10k-row scan + XML build
  // on every request (the global 100 req/60s throttle alone allows
  // ~6k regenerations per hour, which is both expensive and pointless
  // — the sitemap barely changes).
  private sitemapCache: { xml: string; expiresAt: number } | null = null;
  private static readonly SITEMAP_TTL_MS = 60 * 60 * 1000;

  constructor(
    @InjectModel(BlogPost)
    private readonly blogPostModel: typeof BlogPost,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolve the byline for a post.
   *
   * - Registered author: `firstName lastName` from the joined user.
   *   Initials = first letter of each. Falls back to email-local-part
   *   if names are missing (rare but possible if user sets blanks).
   *   `authorAvatarUrl` is the user's uploaded Cloudinary URL when
   *   present; null otherwise (the FE falls back to initials).
   * - Guest contributor: byline = `guestAuthorName`. Initials derived
   *   from the byline (first letters of the first two words).
   *   `authorAvatarUrl` is always null for guests — we have no
   *   identity to attach an avatar to.
   *
   * Pure — does not hit the DB. Caller must have eager-loaded `author`.
   */
  private resolveByline(post: BlogPost): {
    authorName: string;
    authorInitials: string;
    authorAvatarUrl: string | null;
    authorHandle: string | null;
  } {
    if (post.author) {
      const first = post.author.firstName?.trim() ?? '';
      const last = post.author.lastName?.trim() ?? '';
      const name = `${first} ${last}`.trim() || post.author.email || 'Author';
      const initials =
        ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() ||
        name.slice(0, 2).toUpperCase();
      return {
        authorName: name,
        authorInitials: initials,
        authorAvatarUrl: post.author.avatarUrl ?? null,
        authorHandle: post.author.handle ?? null,
      };
    }
    const guest = post.guestAuthorName ?? 'Guest contributor';
    const parts = guest.split(/\s+/).filter(Boolean);
    const initials = (
      (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
    ).toUpperCase();
    return {
      authorName: guest,
      authorInitials: initials || guest.slice(0, 2).toUpperCase(),
      authorAvatarUrl: null,
      authorHandle: null,
    };
  }

  /**
   * Shape a BlogPost row into the public API response. Strips the
   * `author` relation (we only used it to derive the byline) so the
   * response is flat — the FE shouldn't need to know about the
   * underlying join.
   */
  private toResponse(post: BlogPost): BlogPostResponse {
    const { authorName, authorInitials, authorAvatarUrl, authorHandle } =
      this.resolveByline(post);
    const json = post.toJSON();
    delete json.author;
    delete json.deletedAt;
    return {
      ...(json as Omit<
        BlogPostResponse,
        'authorName' | 'authorInitials' | 'authorAvatarUrl' | 'authorHandle'
      >),
      authorName,
      authorInitials,
      authorAvatarUrl,
      authorHandle,
    };
  }

  /**
   * Eager-load shape for `author` — only the columns needed for the
   * byline (name + initials + avatar). Keeps the join cheap and avoids
   * leaking unrelated user fields into a public-blog response.
   */
  private readonly authorInclude = {
    model: User,
    as: 'author',
    attributes: USER_SAFE_ATTRIBUTES,
    required: false,
  };

  async create(
    dto: CreateBlogPostDto,
    authorUserId: string,
    auth: AuthContext,
  ): Promise<BlogPostResponse> {
    // XOR enforcement at the application layer — gives a clearer 400
    // than the DB CHECK would. Three valid input shapes:
    //   1. No guestAuthorName → registered post, authorUserId = caller
    //   2. guestAuthorName set + caller is ADMIN/SUPER_ADMIN → guest
    //      post, authorUserId NULL. Only admins can publish guest
    //      bylines because we have no way to verify the byline matches
    //      a real person.
    //   3. Anything else → 400.
    const isAdmin = auth.roles.some((r) => ADMIN_ROLES.includes(r));
    const guestName = dto.guestAuthorName?.trim();
    if (guestName && !isAdmin) {
      throw new ForbiddenException(apiError('blog.guestBylineAdminsOnly'));
    }
    const post = await this.blogPostModel.create({
      ...dto,
      guestAuthorName: guestName ? guestName : null,
      authorUserId: guestName ? null : authorUserId,
      publishedAt: dto.isPublished ? new Date() : null,
    });
    // Reload with author join so the response includes the byline
    // computed from the freshly-set FK.
    const reloaded = await this.blogPostModel.findByPk(post.id, {
      include: [this.authorInclude],
    });
    if (!reloaded) {
      // Should never happen — we just created it.
      throw new BadRequestException(apiError('blog.reloadFailed'));
    }
    // Prerendered site only shows published posts → rebuild on publish.
    if (reloaded.isPublished) {
      this.triggerWebsiteRebuild(`create ${reloaded.slug}`);
    }
    return this.toResponse(reloaded);
  }

  async findAllPublished(
    query: BlogQueryDto,
  ): Promise<PaginatedResponse<BlogPostResponse>> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const offset = (page - 1) * limit;

    const term = query.search ? buildSearchTerm(query.search) : null;
    const where: WhereOptions<BlogPost> = {
      isPublished: true,
      ...(query.locale && { language: query.locale }),
      ...(query.category && { category: query.category }),
      ...(term && {
        // Search across title, excerpt, and the guest byline. We
        // intentionally do NOT search the joined user firstName /
        // lastName here — including a JOIN-side condition under an
        // [Op.or] forces Sequelize into a sub-query plan that fights
        // pagination. If author search is wanted later, it deserves a
        // proper full-text index across both sources.
        [Op.or]: [
          { title: { [Op.iLike]: term } },
          { excerpt: { [Op.iLike]: term } },
          { guestAuthorName: { [Op.iLike]: term } },
        ],
      }),
    };

    const { rows, count } = await this.blogPostModel.findAndCountAll({
      where,
      attributes: { exclude: ['content', 'deletedAt'] },
      include: [this.authorInclude],
      order: [['publishedAt', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return buildPaginatedResponse(
      rows.map((r) => this.toResponse(r)),
      count,
      page,
      limit,
    );
  }

  /**
   * Admin list — returns published AND draft posts.
   * WRITER sees only their own; ADMIN/SUPER_ADMIN see everything.
   */
  async findAllForAdmin(
    query: BlogQueryDto,
    auth: AuthContext,
  ): Promise<PaginatedResponse<BlogPostResponse>> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const offset = (page - 1) * limit;

    const isAdmin = auth.roles.some((r) => ADMIN_ROLES.includes(r));
    const term = query.search ? buildSearchTerm(query.search) : null;
    const where: WhereOptions<BlogPost> = {
      ...(!isAdmin && { authorUserId: auth.userId }),
      ...(query.locale && { language: query.locale }),
      ...(query.category && { category: query.category }),
      ...(term && {
        [Op.or]: [
          { title: { [Op.iLike]: term } },
          { excerpt: { [Op.iLike]: term } },
          { guestAuthorName: { [Op.iLike]: term } },
        ],
      }),
    };

    const { rows, count } = await this.blogPostModel.findAndCountAll({
      where,
      attributes: { exclude: ['content', 'deletedAt'] },
      include: [this.authorInclude],
      order: [['updatedAt', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return buildPaginatedResponse(
      rows.map((r) => this.toResponse(r)),
      count,
      page,
      limit,
    );
  }

  async getCategories(): Promise<string[]> {
    const results = await this.blogPostModel.findAll({
      attributes: [[fn('DISTINCT', col('category')), 'category']],
      where: { isPublished: true },
      order: [['category', 'ASC']],
      raw: true,
    });

    return results.map((r) => r.category);
  }

  async findBySlug(slug: string, language = 'en'): Promise<BlogPostResponse> {
    const post = await this.blogPostModel.findOne({
      where: publicPostWhere(slug, language),
      attributes: { exclude: ['deletedAt'] },
      include: [this.authorInclude],
    });

    if (!post) {
      throw new NotFoundException(apiError('blog.notFound'));
    }

    return this.toResponse(post);
  }

  /**
   * Internal lookup that returns the entity (with `author` joined) for
   * service code that needs to mutate or auth-check the row.
   */
  private async findEntityById(id: string): Promise<BlogPost> {
    const post = await this.blogPostModel.findByPk(id, {
      include: [this.authorInclude],
    });

    if (!post) {
      throw new NotFoundException(apiError('blog.notFound'));
    }

    return post;
  }

  async findById(id: string): Promise<BlogPostResponse> {
    return this.toResponse(await this.findEntityById(id));
  }

  /**
   * Load a post for editing. Bypasses the isPublished filter so
   * writers can reopen their own drafts. Enforces owner-or-admin.
   */
  async findByIdForEdit(
    id: string,
    auth: AuthContext,
  ): Promise<BlogPostResponse> {
    const post = await this.findEntityById(id);
    this.assertCanEdit(post, auth);
    return this.toResponse(post);
  }

  async update(
    id: string,
    dto: UpdateBlogPostDto,
    auth: AuthContext,
  ): Promise<BlogPostResponse> {
    const post = await this.findEntityById(id);
    this.assertCanEdit(post, auth);
    // Snapshot the previous cover so we can purge it from Cloudinary
    // after the DB write commits, if the writer replaces (or clears) it.
    const previousCover = post.coverImage;
    // Snapshot publish state to decide whether the live (prerendered) site
    // needs a rebuild after this edit.
    const wasPublished = post.isPublished;

    const isAdmin = auth.roles.some((r) => ADMIN_ROLES.includes(r));
    const patch: Partial<BlogPost> = { ...dto };

    // Guard the same XOR rule as create: only admins can re-attribute
    // a post to a guest byline (or move it back from guest to a real
    // author). Writers can edit their own posts but not switch
    // attribution.
    if (dto.guestAuthorName !== undefined && !isAdmin) {
      throw new ForbiddenException(apiError('blog.attributionAdminsOnly'));
    }
    if (dto.guestAuthorName !== undefined) {
      const trimmed = dto.guestAuthorName?.trim();
      if (trimmed) {
        patch.guestAuthorName = trimmed;
        patch.authorUserId = null;
      } else {
        // Clearing the guest byline implies "back to a registered
        // author" — but admins must say which user. Without a way to
        // pass that today, refuse the empty-string clear.
        throw new BadRequestException(apiError('blog.guestAuthorRequired'));
      }
    }

    // First-publish: stamp publishedAt when flipping to published
    if (dto.isPublished && !post.publishedAt) {
      patch.publishedAt = new Date();
    }

    await post.update(patch);

    // Cover replaced or cleared → purge the previous Cloudinary asset.
    if (
      dto.coverImage !== undefined &&
      previousCover &&
      previousCover !== dto.coverImage
    ) {
      await this.cloudinaryService.deleteByUrl(previousCover);
    }

    // Reload to pick up any author-relation change after attribution
    // edits.
    const updated = await this.findEntityById(id);
    // Rebuild the site if this edit touches the published set: a publish, an
    // unpublish, or an edit to an already-live post. Draft-only edits skip it.
    if (wasPublished || updated.isPublished) {
      this.triggerWebsiteRebuild(`update ${updated.slug}`);
    }
    return this.toResponse(updated);
  }

  async delete(id: string, auth: AuthContext): Promise<void> {
    const post = await this.findEntityById(id);
    this.assertCanEdit(post, auth);
    const cover = post.coverImage;
    const wasPublished = post.isPublished;
    const slug = post.slug;
    await post.destroy();
    if (cover) {
      await this.cloudinaryService.deleteByUrl(cover);
    }
    // A published post was live on the site → rebuild to drop its page.
    if (wasPublished) {
      this.triggerWebsiteRebuild(`delete ${slug}`);
    }
  }

  async uploadImage(file: Express.Multer.File, authorId: string) {
    return this.cloudinaryService.uploadImage(file, {
      resource: 'blog',
      userId: authorId,
    });
  }

  /**
   * Ask the marketing site to rebuild so newly published / edited / removed
   * articles get (re)prerendered.
   *
   * The site is a static (prerendered) build — article HTML is generated at
   * deploy time from `GET /blog`, so a published post only appears after a
   * rebuild. This fires a Vercel Deploy Hook to trigger one.
   *
   * Fire-and-forget and fully optional: with no `WEBSITE_DEPLOY_HOOK_URL` set
   * it no-ops (e.g. local dev). Failures are logged, never thrown — a blog
   * mutation must not fail because a deploy webhook was unreachable. Only call
   * this for changes that affect the *published* set (not draft saves).
   */
  private triggerWebsiteRebuild(reason: string): void {
    const url = this.configService.get<string>('WEBSITE_DEPLOY_HOOK_URL');
    if (!url) return;
    void fetch(url, { method: 'POST' })
      .then((res) => {
        if (res.ok) {
          this.logger.log(`Triggered website rebuild (${reason}).`);
        } else {
          this.logger.warn(
            `Website rebuild hook returned ${res.status} (${reason}).`,
          );
        }
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to trigger website rebuild (${reason}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  private async getSitemapRows(): Promise<
    { slug: string; language: string; updatedAt: Date }[]
  > {
    // Hard cap: crawlers get at most the 10k most-recently-updated rows
    // (one row per post per language). An unbounded findAll on a growing
    // table turns this public route into an easy memory/CPU exhaustion
    // target.
    const posts = await this.blogPostModel.findAll({
      where: { isPublished: true },
      attributes: ['slug', 'language', 'updatedAt'],
      order: [['updatedAt', 'DESC']],
      limit: 10_000,
    });
    return posts.map((p) => ({
      slug: p.slug,
      language: p.language,
      updatedAt: p.updatedAt,
    }));
  }

  /**
   * Build (or return cached) sitemap XML for crawlers. The result is
   * cached for one hour so a flood of crawler hits doesn't trigger a
   * fresh 10k-row scan + string-build on every request.
   */
  async getSitemapXml(): Promise<string> {
    const now = Date.now();
    if (!this.sitemapCache || this.sitemapCache.expiresAt <= now) {
      this.sitemapCache = {
        xml: await this.buildSitemapXml(),
        expiresAt: now + BlogService.SITEMAP_TTL_MS,
      };
    }
    return this.sitemapCache.xml;
  }

  /**
   * Blog articles only, one `<url>` per published translation, on the
   * public marketing site (`PUBLIC_SITE_URL`, NOT `FRONTEND_URL`, which is
   * the `app.` origin and redirects to login). Static pages (`/`, `/about`,
   * `/legal/*`, ...) belong to the website's own `sitemap-pages.xml`; the
   * website's `sitemap.xml` index points at both.
   *
   * Translations share a slug and differ by `language`: EN lives at
   * `/blog/<slug>`, RO at `/ro/blog/<slug>`. Each URL carries reciprocal
   * `xhtml:link` hreflang alternates for the translations that exist, plus
   * `x-default` (EN when present).
   */
  private async buildSitemapXml(): Promise<string> {
    const base = this.configService
      .get<string>('PUBLIC_SITE_URL', 'https://www.motionhive.fit')
      .replace(/\/+$/, '');
    const rows = await this.getSitemapRows();

    // slug → language → lastmod. Rows arrive newest-first, so the newest
    // row wins the lastmod and each URL is emitted once.
    //
    // Only URLs `findBySlug` can answer are listed. The site requests the
    // exact path segment, and `publicPostWhere` matches the stored slug and
    // language as they are, so a row is skipped (never trimmed) unless its
    // stored slug already is a clean segment. Trimming would list the URL
    // of a post that 404s there.
    const translations = new Map<string, Map<string, Date>>();
    for (const row of rows) {
      const slug = row.slug ?? '';
      const language = row.language ?? '';
      if (!SITEMAP_SLUG_PATTERN.test(slug)) {
        this.logger.warn(
          `Sitemap: skipping ${language} post with invalid slug ${JSON.stringify(row.slug)}.`,
        );
        continue;
      }
      if (!(language in SITEMAP_LOCALE_PREFIX)) {
        this.logger.warn(
          `Sitemap: skipping post "${slug}" with unsupported language ${JSON.stringify(row.language)}.`,
        );
        continue;
      }
      const byLanguage = translations.get(slug) ?? new Map<string, Date>();
      if (!byLanguage.has(language)) byLanguage.set(language, row.updatedAt);
      translations.set(slug, byLanguage);
    }

    const urlFor = (slug: string, language: string) =>
      `${base}${SITEMAP_LOCALE_PREFIX[language]}/blog/${encodeURIComponent(slug)}`;

    const urlsXml: string[] = [];
    for (const [slug, byLanguage] of translations) {
      const entries = [...byLanguage.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const languages = entries.map(([lang]) => lang);
      const defaultLanguage = byLanguage.has(SITEMAP_DEFAULT_LANGUAGE)
        ? SITEMAP_DEFAULT_LANGUAGE
        : languages[0];
      const alternates = [
        ...languages.map((lang) => ({
          hreflang: lang,
          href: urlFor(slug, lang),
        })),
        { hreflang: 'x-default', href: urlFor(slug, defaultLanguage) },
      ]
        .map(
          (a) =>
            `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${escapeHtml(a.href)}"/>`,
        )
        .join('\n');

      for (const [language, updatedAt] of entries) {
        urlsXml.push(`  <url>
    <loc>${escapeHtml(urlFor(slug, language))}</loc>
    <lastmod>${updatedAt.toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
${alternates}
  </url>`);
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlsXml.join('\n')}
</urlset>
`;
  }

  private assertCanEdit(post: BlogPost, auth: AuthContext): void {
    const isAdmin = auth.roles.some((r) => ADMIN_ROLES.includes(r));
    if (isAdmin) return;
    if (post.authorUserId && post.authorUserId === auth.userId) return;
    throw new ForbiddenException(apiError('blog.ownPostsOnly'));
  }
}
