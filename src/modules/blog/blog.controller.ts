import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
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
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { BlogQueryDto } from './dto/blog-query.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { BlogDocs } from '../../common/docs/blog.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

import type { AuthenticatedRequest } from '../../common/types/authenticated-request';

/**
 * Blog Controller
 *
 * Public (no auth):
 * - GET    /blog                → List published posts (paginated)
 * - GET    /blog/categories     → List distinct published categories
 * - GET    /blog/sitemap.xml    → Sitemap XML for crawlers
 * - GET    /blog/:slug          → Get single published post by slug
 *
 * Authoring (SUPER_ADMIN, ADMIN, WRITER):
 * - GET    /blog/admin          → List ALL posts (drafts + published);
 *                                 WRITER sees own only, ADMIN sees all
 * - GET    /blog/admin/:id      → Get a post by id (any status), owner-or-admin
 * - POST   /blog                → Create post (author = current user)
 * - PATCH  /blog/:id            → Update post (owner-or-admin)
 * - DELETE /blog/:id            → Soft delete (owner-or-admin)
 * - POST   /blog/upload-image   → Upload image to Cloudinary
 */
@ApiTags('Blog')
@Controller('blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  // =====================================================
  // PUBLIC (no auth)
  // =====================================================

  @Get('sitemap.xml')
  async sitemap(@Res() res: Response) {
    const xml = await this.blogService.getSitemapXml();
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    // Bump when the sitemap's shape changes, so a deploy can be checked
    // with a HEAD request. 2 = public-site host, one URL per translation
    // with hreflang alternates.
    res.setHeader('X-Sitemap-Version', '2');
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

  // =====================================================
  // AUTHORING (auth required) — admin routes registered
  // BEFORE :slug so "admin" is not captured as a slug.
  // =====================================================

  @Get('admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'WRITER')
  @ApiEndpoint(BlogDocs.listForAdmin)
  async listForAdmin(
    @Query() query: BlogQueryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.blogService.findAllForAdmin(query, {
      userId: req.user.id,
      roles: req.user.roles,
    });
  }

  @Get('admin/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'WRITER')
  @ApiEndpoint(BlogDocs.getForEdit)
  async getForEdit(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.blogService.findByIdForEdit(id, {
      userId: req.user.id,
      roles: req.user.roles,
    });
  }

  @Get(':slug')
  @ApiEndpoint(BlogDocs.getBySlug)
  async getBySlug(@Param('slug') slug: string, @Query('locale') locale = 'en') {
    return this.blogService.findBySlug(slug, locale);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'WRITER')
  @ApiEndpoint({ ...BlogDocs.create, body: CreateBlogPostDto })
  async create(
    @Body() dto: CreateBlogPostDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.blogService.create(dto, req.user.id, {
      userId: req.user.id,
      roles: req.user.roles,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'WRITER')
  @ApiEndpoint({ ...BlogDocs.update, body: UpdateBlogPostDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlogPostDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.blogService.update(id, dto, {
      userId: req.user.id,
      roles: req.user.roles,
    });
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'WRITER')
  @ApiEndpoint(BlogDocs.delete)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.blogService.delete(id, {
      userId: req.user.id,
      roles: req.user.roles,
    });
    return { message: 'Blog post deleted successfully' };
  }

  @Post('upload-image')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN', 'WRITER')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiEndpoint(BlogDocs.uploadImage)
  async uploadImage(
    @Request() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.blogService.uploadImage(file, req.user.id);
  }
}
