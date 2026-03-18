import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, fn, col } from 'sequelize';
import { BlogPost } from './entities/blog-post.entity';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { BlogQueryDto } from './dto/blog-query.dto';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { buildPaginatedResponse } from '../../common/dto/pagination.dto';
import { buildSearchTerm } from '../../common/utils/search.utils';

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(BlogPost)
    private blogPostModel: typeof BlogPost,
    private cloudinaryService: CloudinaryService,
  ) {}

  async create(dto: CreateBlogPostDto): Promise<BlogPost> {
    const post = await this.blogPostModel.create({
      ...dto,
      publishedAt: dto.isPublished ? new Date() : null,
    });
    return post;
  }

  async findAllPublished(query: BlogQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const offset = (page - 1) * limit;

    const where: any = { isPublished: true };
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

  async getCategories(): Promise<string[]> {
    const results = await this.blogPostModel.findAll({
      attributes: [[fn('DISTINCT', col('category')), 'category']],
      where: { isPublished: true },
      order: [['category', 'ASC']],
      raw: true,
    });

    return results.map((r) => r.category);
  }

  async findBySlug(slug: string): Promise<BlogPost> {
    const post = await this.blogPostModel.findOne({
      where: { slug, isPublished: true },
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

  async update(id: string, dto: UpdateBlogPostDto): Promise<BlogPost> {
    const post = await this.findById(id);

    // If publishing for the first time, set publishedAt
    if (dto.isPublished && !post.publishedAt) {
      dto['publishedAt'] = new Date() as any;
    }

    await post.update(dto);
    return post;
  }

  async delete(id: string): Promise<void> {
    const post = await this.findById(id);
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
}
