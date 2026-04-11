import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes } from '@nestjs/swagger';
import { BlogService } from './blog.service';
import { ConfigService } from '@nestjs/config';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { BlogQueryDto } from './dto/blog-query.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { BlogDocs } from '../../common/docs/blog.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * Blog Controller
 *
 * Public:
 * - GET    /blog              → List published posts (paginated)
 * - GET    /blog/categories   → List distinct published categories
 * - GET    /blog/:slug        → Get single post by slug
 *
 * Admin (SUPER_ADMIN, ADMIN):
 * - POST   /blog              → Create post
 * - PATCH  /blog/:id          → Update post
 * - DELETE /blog/:id          → Soft delete post
 * - POST   /blog/upload-image → Upload image to Cloudinary
 */
@ApiTags('Blog')
@Controller('blog')
export class BlogController {
  constructor(
    private readonly blogService: BlogService,
    private readonly configService: ConfigService,
  ) {}

  // =====================================================
  // PUBLIC (no auth)
  // =====================================================

  @Get('sitemap.xml')
  async sitemap(@Res() res: Response) {
    const posts = await this.blogService.getSitemapSlugs();
    const BASE = this.configService.get<string>(
      'FRONTEND_URL',
      'https://motionhive.fit',
    );

    const staticUrls = [
      { loc: `${BASE}/`, priority: '1.0', changefreq: 'weekly' },
      { loc: `${BASE}/about`, priority: '0.7', changefreq: 'monthly' },
      { loc: `${BASE}/blog`, priority: '0.9', changefreq: 'daily' },
      {
        loc: `${BASE}/legal/terms-of-service`,
        priority: '0.3',
        changefreq: 'yearly',
      },
      {
        loc: `${BASE}/legal/privacy-policy`,
        priority: '0.3',
        changefreq: 'yearly',
      },
    ];

    const staticXml = staticUrls
      .map(
        (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
      )
      .join('\n');

    const blogXml = posts
      .map(
        (p) => `  <url>
    <loc>${BASE}/blog/${p.slug}</loc>
    <lastmod>${p.updatedAt.toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`,
      )
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticXml}
${blogXml}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  }

  @Get()
  @ApiEndpoint(BlogDocs.listPublished)
  async listPublished(@Query() query: BlogQueryDto) {
    return this.blogService.findAllPublished(query);
  }

  @Get('categories')
  @ApiEndpoint(BlogDocs.getCategories)
  async getCategories() {
    return this.blogService.getCategories();
  }

  @Get(':slug')
  @ApiEndpoint(BlogDocs.getBySlug)
  async getBySlug(@Param('slug') slug: string, @Query('locale') locale = 'en') {
    return this.blogService.findBySlug(slug, locale);
  }

  // =====================================================
  // ADMIN (auth required)
  // =====================================================

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...BlogDocs.create, body: CreateBlogPostDto })
  async create(@Body() dto: CreateBlogPostDto) {
    return this.blogService.create(dto);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...BlogDocs.update, body: UpdateBlogPostDto })
  async update(@Param('id') id: string, @Body() dto: UpdateBlogPostDto) {
    return this.blogService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(BlogDocs.delete)
  async delete(@Param('id') id: string) {
    await this.blogService.delete(id);
    return { message: 'Blog post deleted successfully' };
  }

  @Post('upload-image')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint(BlogDocs.uploadImage)
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    return this.blogService.uploadImage(file);
  }
}
