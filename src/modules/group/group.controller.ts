import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { GroupService } from './group.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { DiscoverGroupsDto } from './dto/discover-groups.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { GroupDocs } from '../../common/docs/group.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Group Controller
 *
 * Manages groups (training groups, fitness crews, teams):
 *
 * Public (no auth):
 * - GET    /groups/discover              -> Browse/search public groups
 * - GET    /groups/:id/public            -> Public profile (group + instructor + sessions)
 *
 * Authenticated:
 * - POST   /groups                       -> Create group (INSTRUCTOR only)
 * - GET    /groups                       -> List my groups
 * - GET    /groups/:id                   -> Get group details (member only)
 * - PATCH  /groups/:id                   -> Update group (owner only)
 * - DELETE /groups/:id                   -> Delete group (owner only)
 * - POST   /groups/:id/join             -> Self-join (public + OPEN policy only)
 * - GET    /groups/:id/members          -> List members (paginated)
 * - PATCH  /groups/:id/members/me       -> Update own membership settings
 * - DELETE /groups/:id/members/me       -> Leave group
 * - DELETE /groups/:id/members/:userId  -> Remove member (owner only)
 * - POST   /groups/:id/join-link        -> Generate join link (INSTRUCTOR, owner only)
 * - DELETE /groups/:id/join-link        -> Revoke join link (INSTRUCTOR, owner only)
 * - POST   /groups/join/:token          -> Join via link
 */
@ApiTags('Groups')
@Controller('groups')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  // =====================================================
  // DISCOVERY (public -- no auth required)
  // =====================================================

  @Get('discover')
  @ApiEndpoint(GroupDocs.discoverGroups)
  async discoverGroups(@Query() dto: DiscoverGroupsDto) {
    return this.groupService.discoverGroups(dto);
  }

  @Get(':id/public')
  @ApiEndpoint(GroupDocs.getPublicProfile)
  async getPublicProfile(@Param('id') id: string) {
    return this.groupService.getPublicProfile(id);
  }

  // =====================================================
  // GROUP CRUD (auth required)
  // =====================================================

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({ ...GroupDocs.create, body: CreateGroupDto })
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateGroupDto,
  ) {
    return this.groupService.create(req.user.id, dto);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.getMyGroups)
  async getMyGroups(@Request() req: AuthenticatedRequest) {
    return this.groupService.getMyGroups(req.user.id);
  }

  @Get('/instructor')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.getInstructorsGroups)
  async getInstructorsGroups(@Request() req: AuthenticatedRequest) {
    return this.groupService.getInstructorsGroups(req.user.id);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.getById)
  async getById(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.groupService.getById(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({ ...GroupDocs.update, body: UpdateGroupDto })
  async update(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.deleteGroup)
  async deleteGroup(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.groupService.deleteGroup(id, req.user.id);
    return { message: 'Group deleted successfully' };
  }

  @Post(':id/transfer-ownership')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({
    summary: 'Transfer group ownership',
    description: 'Transfer ownership to another member. Current owner only.',
    auth: true,
    responses: [{ status: 200, description: 'Ownership transferred' }],
  })
  async transferOwnership(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: { newOwnerId: string },
  ) {
    return this.groupService.transferOwnership(id, req.user.id, dto.newOwnerId);
  }

  @Get(':id/stats')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({
    summary: 'Get group statistics',
    description:
      'Member count, session counts, etc. Requires group membership.',
    auth: true,
    responses: [{ status: 200, description: 'Group statistics' }],
  })
  async getStats(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupService.getGroupStats(id, req.user.id);
  }

  // =====================================================
  // SELF-JOIN (auth required)
  // =====================================================

  @Post(':id/join')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.selfJoin)
  async selfJoin(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.groupService.selfJoinGroup(id, req.user.id);
    return { message: 'You have joined the group' };
  }

  // =====================================================
  // MEMBER MANAGEMENT (auth required)
  // =====================================================

  @Get(':id/members')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.getMembers)
  async getMembers(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    return this.groupService.getMembers(
      id,
      req.user.id,
      pagination.page,
      pagination.limit,
    );
  }

  @Patch(':id/members/me')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({ ...GroupDocs.updateMyMembership, body: UpdateMemberDto })
  async updateMyMembership(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.groupService.updateMyMembership(id, req.user.id, dto);
  }

  @Delete(':id/members/me')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.leaveGroup)
  async leaveGroup(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.groupService.leaveGroup(id, req.user.id);
    return { message: 'You have left the group' };
  }

  @Delete(':id/members/:userId')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.removeMember)
  async removeMember(
    @Param('id') id: string,
    @Param('userId') memberId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.groupService.removeMember(id, memberId, req.user.id);
    return { message: 'Member removed successfully' };
  }

  // =====================================================
  // JOIN LINK MANAGEMENT (INSTRUCTOR, owner only)
  // =====================================================

  @Post(':id/join-link')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(GroupDocs.generateJoinLink)
  async generateJoinLink(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const result = await this.groupService.generateJoinLink(id, req.user.id);
    return {
      message: 'Join link generated successfully',
      token: result.token,
      expiresAt: result.expiresAt,
    };
  }

  @Delete(':id/join-link')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(GroupDocs.revokeJoinLink)
  async revokeJoinLink(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.groupService.revokeJoinLink(id, req.user.id);
    return { message: 'Join link revoked successfully' };
  }

  @Post('join/:token')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.joinViaLink)
  async joinViaLink(
    @Param('token') token: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.groupService.joinViaLink(token, req.user.id);
    return { message: 'You have joined the group' };
  }
}
