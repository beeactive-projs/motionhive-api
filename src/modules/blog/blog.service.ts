import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, fn, col, WhereOptions } from 'sequelize';
import { BlogPost } from './entities/blog-post.entity';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { BlogQueryDto } from './dto/blog-query.dto';
import { User } from '../user/entities/user.entity';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import {
  buildPaginatedResponse,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { buildSearchTerm } from '../../common/utils/search.utils';

interface AuthContext {
  userId: string;
  roles: string[];
}

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

/**
 * Public blog post response — what the FE actually receives. Includes
 * the legacy `authorName` and `authorInitials` fields (now COMPUTED at
 * read time from the user join, or from `guestAuthorName` for guest
 * contributors). The legacy `authorRole` field is dropped — no FE
 * surface displayed it.
 *
 * The DB no longer stores `author_name` / `author_initials` /
 * `author_role` (migration 033). Storage is `authorUserId` (FK)
 * XOR `guestAuthorName` (string).
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
  constructor(
    @InjectModel(BlogPost)
    private blogPostModel: typeof BlogPost,
    private cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Resolve the byline for a post.
   *
   * - Registered author: `firstName lastName` from the joined user.
   *   Initials = first letter of each. Falls back to email-local-part
   *   if names are missing (rare but possible if user sets blanks).
   * - Guest contributor: byline = `guestAuthorName`. Initials derived
   *   from the byline (first letters of the first two words).
   *
   * Pure — does not hit the DB. Caller must have eager-loaded `author`.
   */
  private resolveByline(post: BlogPost): {
    authorName: string;
    authorInitials: string;
  } {
    if (post.author) {
      const first = post.author.firstName?.trim() ?? '';
      const last = post.author.lastName?.trim() ?? '';
      const name = `${first} ${last}`.trim() || post.author.email || 'Author';
      const initials =
        ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() ||
        name.slice(0, 2).toUpperCase();
      return { authorName: name, authorInitials: initials };
    }
    const guest = post.guestAuthorName ?? 'Guest contributor';
    const parts = guest.split(/\s+/).filter(Boolean);
    const initials = (
      (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
    ).toUpperCase();
    return {
      authorName: guest,
      authorInitials: initials || guest.slice(0, 2).toUpperCase(),
    };
  }

  /**
   * Shape a BlogPost row into the public API response. Strips the
   * `author` relation (we only used it to derive the byline) so the
   * response is flat — the FE shouldn't need to know about the
   * underlying join.
   */
  private toResponse(post: BlogPost): BlogPostResponse {
    const { authorName, authorInitials } = this.resolveByline(post);
    const json = post.toJSON();
    delete json.author;
    delete json.deletedAt;
    return {
      ...(json as Omit<BlogPostResponse, 'authorName' | 'authorInitials'>),
      authorName,
      authorInitials,
    };
  }

  /**
   * Eager-load shape for `author` — only the columns needed for the
   * byline. Keeps the join cheap and avoids leaking unrelated user
   * fields into a public-blog response.
   */
  private readonly authorInclude = {
    model: User,
    as: 'author',
    attributes: ['id', 'firstName', 'lastName', 'email'],
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
      throw new ForbiddenException(
        'Only admins can publish posts under a guest byline.',
      );
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
      throw new BadRequestException('Failed to load created post.');
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
      where: { slug, language, isPublished: true },
      attributes: { exclude: ['deletedAt'] },
      include: [this.authorInclude],
    });

    if (!post) {
      throw new NotFoundException('Blog post not found');
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
      throw new NotFoundException('Blog post not found');
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

    const isAdmin = auth.roles.some((r) => ADMIN_ROLES.includes(r));
    const patch: Partial<BlogPost> = { ...dto };

    // Guard the same XOR rule as create: only admins can re-attribute
    // a post to a guest byline (or move it back from guest to a real
    // author). Writers can edit their own posts but not switch
    // attribution.
    if (dto.guestAuthorName !== undefined && !isAdmin) {
      throw new ForbiddenException(
        'Only admins can change a post’s author attribution.',
      );
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
        throw new BadRequestException(
          'guestAuthorName cannot be cleared without re-assigning to a registered author.',
        );
      }
    }

    // First-publish: stamp publishedAt when flipping to published
    if (dto.isPublished && !post.publishedAt) {
      patch.publishedAt = new Date();
    }

    await post.update(patch);
    // Reload to pick up any author-relation change after attribution
    // edits.
    return this.toResponse(await this.findEntityById(id));
  }

  async delete(id: string, auth: AuthContext): Promise<void> {
    const post = await this.findEntityById(id);
    this.assertCanEdit(post, auth);
    await post.destroy();
  }

  async uploadImage(file: Express.Multer.File) {
    return this.cloudinaryService.uploadImage(file, 'blog');
  }

  async getSitemapSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
    // Hard cap: crawlers get at most the 10k most-recently-updated posts.
    // An unbounded findAll on a growing table turns this public route
    // into an easy memory/CPU exhaustion target.
    const posts = await this.blogPostModel.findAll({
      where: { isPublished: true },
      attributes: ['slug', 'updatedAt'],
      order: [['updatedAt', 'DESC']],
      limit: 10_000,
    });
    return posts.map((p) => ({ slug: p.slug, updatedAt: p.updatedAt }));
  }

  private assertCanEdit(post: BlogPost, auth: AuthContext): void {
    const isAdmin = auth.roles.some((r) => ADMIN_ROLES.includes(r));
    if (isAdmin) return;
    if (post.authorUserId && post.authorUserId === auth.userId) return;
    throw new ForbiddenException('You can only edit your own posts');
  }
}
