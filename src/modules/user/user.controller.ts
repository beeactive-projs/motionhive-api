import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { SearchUsersQueryDto } from './dto/search-users.query.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { UserDocs } from '../../common/docs/user.docs';

/**
 * User Controller
 *
 * Handles user-related endpoints:
 * - GET    /users/me → Get current user profile
 * - PATCH  /users/me → Update user core fields
 * - DELETE /users/me → Delete account (GDPR)
 *
 * All endpoints require JWT authentication.
 */
@ApiTags('Users')
@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Get Current User Profile
   */
  @Get('me')
  @ApiEndpoint(UserDocs.getProfile)
  getProfile(@Request() req: AuthenticatedRequest) {
    return {
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      phone: req.user.phone,
      avatarId: req.user.avatarId,
      avatarUrl: req.user.avatarUrl,
      language: req.user.language,
      timezone: req.user.timezone,
      isActive: req.user.isActive,
      isEmailVerified: req.user.isEmailVerified,
      roles: req.user.roles,
      createdAt: req.user.createdAt,
    };
  }

  /**
   * Search users for pickers (e.g. "invite a client").
   * Authenticated. Rate-limited. Never returns sensitive fields.
   */
  @Get('search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiEndpoint({
    summary: 'Search users',
    description:
      'Partial-match search on email/first/last name. Supports optional role filter and excluding users already connected to the calling instructor.',
    auth: true,
    responses: [
      { status: 200, description: 'Matching users' },
      { status: 400, description: 'Invalid query' },
    ],
  })
  async searchUsers(
    @Request() req: AuthenticatedRequest,
    @Query() query: SearchUsersQueryDto,
  ) {
    const excludeConnectedToInstructorId =
      query.excludeConnected && req.user.roles?.includes('INSTRUCTOR')
        ? req.user.id
        : undefined;

    return this.userService.searchUsers({
      q: query.q,
      role: query.role,
      excludeUserId: req.user.id,
      excludeConnectedToInstructorId,
      limit: query.limit,
    });
  }

  /**
   * Update core user fields (name, phone, avatar, language, timezone)
   */
  @Patch('me')
  @ApiEndpoint({ ...UserDocs.updateProfile, body: UpdateUserDto })
  async updateProfile(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateUserDto,
  ) {
    const user = await this.userService.updateUser(req.user.id, dto);
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatarId: user.avatarId,
      avatarUrl: user.avatarUrl,
      language: user.language,
      timezone: user.timezone,
    };
  }

  /**
   * Upload a new profile picture. Accepts a single image under the
   * `file` form field. The server streams it to Cloudinary (folder
   * `avatars/`), saves the secure URL on the user, and cleans up the
   * previous asset. Returns the new avatar URL so the UI can swap the
   * image in place without refetching the whole profile.
   */
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiEndpoint({
    summary: 'Upload profile picture',
    description:
      'Accepts an image file under the `file` form field. Max 5 MB, image MIME types only.',
    auth: true,
    responses: [
      { status: 200, description: 'Avatar uploaded' },
      { status: 400, description: 'No file, wrong type, or too large' },
    ],
  })
  async uploadAvatar(
    @Request() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
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
    const user = await this.userService.uploadAvatar(req.user.id, file);
    return {
      avatarUrl: user.avatarUrl,
    };
  }

  /**
   * Export all user data (GDPR Article 20 - Data Portability)
   */
  @Post('me/data-export')
  @Throttle({ default: { limit: 2, ttl: 3600000 } })
  @ApiEndpoint({
    summary: 'Export my data',
    description:
      'Export all user data as JSON (GDPR Article 20). Includes profile, memberships, sessions, etc.',
    auth: true,
    responses: [{ status: 200, description: 'User data export' }],
  })
  async exportData(@Request() req: AuthenticatedRequest) {
    return this.userService.exportUserData(req.user.id);
  }

  /**
   * Delete account (GDPR - soft delete)
   */
  @Delete('me')
  @Throttle({ default: { limit: 1, ttl: 3600000 } })
  @ApiEndpoint(UserDocs.deleteAccount)
  async deleteAccount(@Request() req: AuthenticatedRequest) {
    await this.userService.deleteAccount(req.user.id);
    return { message: 'Account deleted successfully' };
  }
}
