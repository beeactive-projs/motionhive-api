import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { PostService } from './post.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { DeletePostDto } from './dto/delete-post.dto';
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
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint(PostDocs.uploadImage)
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string; publicId: string }> {
    if (!file) {
      throw new BadRequestException('No file provided.');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Only image files are accepted.');
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('File is larger than 5 MB.');
    }
    return this.cloudinaryService.uploadImage(file, 'posts');
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

  @Get('group/:groupId')
  @ApiEndpoint(PostDocs.getGroupFeed)
  async getGroupFeed(
    @Request() req: AuthenticatedRequest,
    @Param('groupId') groupId: string,
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
    @Param('groupId') groupId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.postService.getPendingForGroup(
      req.user.id,
      groupId,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }

  @Patch(':postId')
  @ApiEndpoint({ ...PostDocs.updatePost, body: UpdatePostDto })
  async updatePost(
    @Request() req: AuthenticatedRequest,
    @Param('postId') postId: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.postService.updatePost(req.user.id, postId, dto);
  }

  @Delete(':postId')
  @ApiEndpoint({ ...PostDocs.deletePost, body: DeletePostDto })
  async deletePost(
    @Request() req: AuthenticatedRequest,
    @Param('postId') postId: string,
    @Body() dto: DeletePostDto,
  ) {
    return this.postService.deletePost(req.user.id, postId, dto ?? {});
  }

  @Patch(':postId/audiences/:groupId')
  @ApiEndpoint({ ...PostDocs.moderatePost, body: ModeratePostDto })
  async moderatePost(
    @Request() req: AuthenticatedRequest,
    @Param('postId') postId: string,
    @Param('groupId') groupId: string,
    @Body() dto: ModeratePostDto,
  ): Promise<{ ok: true }> {
    await this.postService.moderatePost(req.user.id, postId, groupId, dto);
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
    @Param('postId') postId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.postService.addComment(req.user.id, postId, dto);
  }

  @Get(':postId/comments')
  @ApiEndpoint(PostDocs.getComments)
  async getComments(
    @Request() req: AuthenticatedRequest,
    @Param('postId') postId: string,
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
    @Param('commentId') commentId: string,
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
    @Param('postId') postId: string,
    @Body() dto: ToggleReactionDto,
  ) {
    return this.postService.toggleReaction(req.user.id, postId, dto ?? {});
  }
}
