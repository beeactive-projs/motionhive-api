import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, fn, col } from 'sequelize';
import { BlogPost } from './entities/blog-post.entity';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { BlogQueryDto } from './dto/blog-query.dto';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { buildPaginatedResponse } from '../../common/dto/pagination.dto';
import { buildSearchTerm } from '../../common/utils/search.utils';

interface AuthContext {
  userId: string;
  roles: string[];
}

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(BlogPost)
    private blogPostModel: typeof BlogPost,
    private cloudinaryService: CloudinaryService,
  ) {}

  async create(
    dto: CreateBlogPostDto,
    authorUserId: string,
  ): Promise<BlogPost> {
    const post = await this.blogPostModel.create({
      ...dto,
      authorUserId,
      publishedAt: dto.isPublished ? new Date() : null,
    });
    return post;
  }

  async findAllPublished(query: BlogQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const offset = (page - 1) * limit;

    const where: any = { isPublished: true };
    if (query.locale) {
      where.language = query.locale;
    }
    if (query.category) {
      where.category = query.category;
    }
    if (query.search) {
      const term = buildSearchTerm(query.search);
      where[Op.or] = [
        { title: { [Op.iLike]: term } },
        { excerpt: { [Op.iLike]: term } },
        { authorName: { [Op.iLike]: term } },
      ];
    }

    const { rows, count } = await this.blogPostModel.findAndCountAll({
      where,
      attributes: { exclude: ['content', 'deletedAt'] },
      order: [['publishedAt', 'DESC']],
      limit,
      offset,
    });

    return buildPaginatedResponse(rows, count, page, limit);
  }

  /**
   * Admin list — returns published AND draft posts.
   * WRITER sees only their own; ADMIN/SUPER_ADMIN see everything.
   */
  async findAllForAdmin(query: BlogQueryDto, auth: AuthContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const offset = (page - 1) * limit;

    const where: any = {};

    const isAdmin = auth.roles.some((r) => ADMIN_ROLES.includes(r));
    if (!isAdmin) {
      where.authorUserId = auth.userId;
    }

    if (query.locale) {
      where.language = query.locale;
    }
    if (query.category) {
      where.category = query.category;
    }
    if (query.search) {
      const term = buildSearchTerm(query.search);
      where[Op.or] = [
        { title: { [Op.iLike]: term } },
        { excerpt: { [Op.iLike]: term } },
        { authorName: { [Op.iLike]: term } },
      ];
    }

    const { rows, count } = await this.blogPostModel.findAndCountAll({
      where,
      attributes: { exclude: ['content', 'deletedAt'] },
      order: [['updatedAt', 'DESC']],
      limit,
      offset,
    });

    return buildPaginatedResponse(rows, count, page, limit);
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

  async findBySlug(slug: string, language = 'en'): Promise<BlogPost> {
    const post = await this.blogPostModel.findOne({
      where: { slug, language, isPublished: true },
      attributes: { exclude: ['deletedAt'] },
    });

    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    return post;
  }

  async findById(id: string): Promise<BlogPost> {
    const post = await this.blogPostModel.findByPk(id);

    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    return post;
  }

  /**
   * Load a post for editing. Bypasses the isPublished filter so
   * writers can reopen their own drafts. Enforces owner-or-admin.
   */
  async findByIdForEdit(id: string, auth: AuthContext): Promise<BlogPost> {
    const post = await this.findById(id);
    this.assertCanEdit(post, auth);
    return post;
  }

  async update(
    id: string,
    dto: UpdateBlogPostDto,
    auth: AuthContext,
  ): Promise<BlogPost> {
    const post = await this.findById(id);
    this.assertCanEdit(post, auth);

    const patch: Partial<BlogPost> = { ...dto };

    // First-publish: stamp publishedAt when flipping to published
    if (dto.isPublished && !post.publishedAt) {
      patch.publishedAt = new Date();
    }

    await post.update(patch);
    return post;
  }

  async delete(id: string, auth: AuthContext): Promise<void> {
    const post = await this.findById(id);
    this.assertCanEdit(post, auth);
    await post.destroy();
  }

  async uploadImage(file: Express.Multer.File) {
    return this.cloudinaryService.uploadImage(file, 'blog');
  }

  async getSitemapSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
    const posts = await this.blogPostModel.findAll({
      where: { isPublished: true },
      attributes: ['slug', 'updatedAt'],
      order: [['updatedAt', 'DESC']],
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
