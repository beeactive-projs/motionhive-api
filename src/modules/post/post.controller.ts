import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { PostDocs } from '../../common/docs/post.docs';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import {
  assertImageFile,
  IMAGE_UPLOAD_OPTIONS,
} from '../../common/utils/image.utils';
import { PostService } from './post.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ModeratePostDto } from './dto/moderate-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ToggleReactionDto } from './dto/toggle-reaction.dto';

@ApiTags('Posts')
@Controller('posts')
@UseGuards(AuthGuard('jwt'))
export class PostController {
  constructor(
    private readonly postService: PostService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // =====================================================
  // IMAGE UPLOAD
  // =====================================================

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint(PostDocs.uploadImage)
  async uploadImage(
    @Request() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ url: string; publicId: string }> {
    assertImageFile(file);
    return this.cloudinaryService.uploadImage(file, {
      resource: 'posts',
      userId: req.user.id,
    });
  }

  // =====================================================
  // CRUD
  // =====================================================

  @Post()
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  @ApiEndpoint({ ...PostDocs.createPost, body: CreatePostDto })
  async createPost(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreatePostDto,
  ) {
    return this.postService.createPost(req.user.id, dto);
  }

  @Get('feed')
  @ApiEndpoint(PostDocs.getMyFeed)
  async getMyFeed(
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    return this.postService.getMyFeed(
      req.user.id,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }

  @Get('group/:groupId')
  @ApiEndpoint(PostDocs.getGroupFeed)
  async getGroupFeed(
    @Request() req: AuthenticatedRequest,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.postService.getGroupFeed(
      req.user.id,
      groupId,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }

  @Get('group/:groupId/pending')
  @ApiEndpoint(PostDocs.getGroupPending)
  async getGroupPending(
    @Request() req: AuthenticatedRequest,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.postService.getPendingForGroup(
      req.user.id,
      groupId,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }

  @Get(':postId')
  @ApiEndpoint(PostDocs.getPost)
  async getPost(
    @Request() req: AuthenticatedRequest,
    @Param('postId') postId: string,
  ) {
    return this.postService.getPostById(req.user.id, postId);
  }

  @Patch(':postId')
  @ApiEndpoint({ ...PostDocs.updatePost, body: UpdatePostDto })
  async updatePost(
    @Request() req: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.postService.updatePost(req.user.id, postId, dto);
  }

  @Delete(':postId')
  @ApiEndpoint(PostDocs.deletePost)
  async deletePost(
    @Request() req: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
  ) {
    return this.postService.deletePost(req.user.id, postId);
  }

  @Patch(':postId/moderate')
  @ApiEndpoint({ ...PostDocs.moderatePost, body: ModeratePostDto })
  async moderatePost(
    @Request() req: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: ModeratePostDto,
  ): Promise<{ ok: true }> {
    await this.postService.moderatePost(req.user.id, postId, dto);
    return { ok: true };
  }

  // =====================================================
  // COMMENTS
  // =====================================================

  @Post(':postId/comments')
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  @ApiEndpoint({ ...PostDocs.addComment, body: CreateCommentDto })
  async addComment(
    @Request() req: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.postService.addComment(req.user.id, postId, dto);
  }

  @Get(':postId/comments')
  @ApiEndpoint(PostDocs.getComments)
  async getComments(
    @Request() req: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.postService.getComments(
      req.user.id,
      postId,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }

  @Delete(':postId/comments/:commentId')
  @ApiEndpoint(PostDocs.deleteComment)
  async deleteComment(
    @Request() req: AuthenticatedRequest,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<{ ok: true }> {
    await this.postService.deleteComment(req.user.id, commentId);
    return { ok: true };
  }

  // =====================================================
  // REACTIONS
  // =====================================================

  @Post(':postId/reactions')
  @Throttle({ default: { limit: 240, ttl: 3_600_000 } })
  @ApiEndpoint({ ...PostDocs.toggleReaction, body: ToggleReactionDto })
  async toggleReaction(
    @Request() req: AuthenticatedRequest,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: ToggleReactionDto,
  ) {
    return this.postService.toggleReaction(req.user.id, postId, dto ?? {});
  }
}
