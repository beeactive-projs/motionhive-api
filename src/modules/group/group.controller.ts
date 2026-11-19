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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { GroupDocs } from '../../common/docs/group.docs';
import { GroupRoleDocs } from '../../common/docs/post.docs';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AddMembersBulkDto } from './dto/add-members-bulk.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { DecideJoinRequestDto } from './dto/decide-join-request.dto';
import { DiscoverGroupsDto } from './dto/discover-groups.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { GroupService } from './group.service';

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
 * - POST   /groups/:id/join             -> Self-join OPEN, or request join on APPROVAL
 * - GET    /groups/:id/join-requests    -> List pending requests (owner only)
 * - GET    /groups/:id/join-requests/mine -> Get my pending request (or null)
 * - DELETE /groups/:id/join-requests/mine -> Cancel my pending request
 * - PATCH  /groups/:id/join-requests/:rid -> Approve or reject (owner only)
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
  @UseGuards(OptionalJwtAuthGuard)
  @ApiEndpoint(GroupDocs.discoverGroups)
  async discoverGroups(
    @Query() dto: DiscoverGroupsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupService.discoverGroups(dto, req.user?.id ?? null);
  }

  @Get(':id/public')
  @ApiEndpoint(GroupDocs.getPublicProfile)
  async getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
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
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupService.getById(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({ ...GroupDocs.update, body: UpdateGroupDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.deleteGroup)
  async deleteGroup(
    @Param('id', ParseUUIDPipe) id: string,
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
    body: TransferOwnershipDto,
    responses: [{ status: 200, description: 'Ownership transferred' }],
  })
  async transferOwnership(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: TransferOwnershipDto,
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
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const result = await this.groupService.selfJoinGroup(id, req.user.id);
    if (result.status === 'JOINED') {
      return {
        status: 'JOINED' as const,
        message: 'You have joined the group',
        member: result.member,
      };
    }
    return {
      status: 'PENDING' as const,
      message: 'Your request to join has been sent. The owner will review it.',
      request: result.request,
    };
  }

  // =====================================================
  // JOIN REQUESTS (APPROVAL groups)
  // =====================================================

  @Get(':id/join-requests')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.listJoinRequests)
  async listJoinRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    return this.groupService.listJoinRequests(
      id,
      req.user.id,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }

  @Get(':id/join-requests/mine')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.getMyJoinRequest)
  async getMyJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const request = await this.groupService.getMyJoinRequest(id, req.user.id);
    return { request };
  }

  @Delete(':id/join-requests/mine')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.cancelMyJoinRequest)
  async cancelMyJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.groupService.cancelMyJoinRequest(id, req.user.id);
    return { message: 'Request cancelled' };
  }

  @Patch(':id/join-requests/:requestId')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({
    ...GroupDocs.decideJoinRequest,
    body: DecideJoinRequestDto,
  })
  async decideJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: DecideJoinRequestDto,
  ) {
    return this.groupService.decideJoinRequest(id, requestId, req.user.id, dto);
  }

  // =====================================================
  // MEMBER MANAGEMENT (auth required)
  // =====================================================

  @Get(':id/members')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.getMembers)
  async getMembers(
    @Param('id', ParseUUIDPipe) id: string,
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

  @Post(':id/members/bulk')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({
    summary: 'Add multiple members',
    description:
      'Add multiple users to the group in a single request. Owner only. Already-existing active members are silently skipped.',
    auth: true,
    body: AddMembersBulkDto,
    responses: [{ status: 201, description: 'Members added' }],
  })
  async addMembersBulk(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: AddMembersBulkDto,
  ) {
    return this.groupService.addMembersBulk(id, req.user.id, dto.userIds);
  }

  @Patch(':id/members/me')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({ ...GroupDocs.updateMyMembership, body: UpdateMemberDto })
  async updateMyMembership(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.groupService.updateMyMembership(id, req.user.id, dto);
  }

  @Delete(':id/members/me')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.leaveGroup)
  async leaveGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.groupService.leaveGroup(id, req.user.id);
    return { message: 'You have left the group' };
  }

  @Delete(':id/members/:userId')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint(GroupDocs.removeMember)
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.groupService.removeMember(id, memberId, req.user.id);
    return { message: 'Member removed successfully' };
  }

  @Patch(':id/members/:userId/role')
  @UseGuards(AuthGuard('jwt'))
  @ApiEndpoint({ ...GroupRoleDocs.updateMemberRole, body: UpdateMemberRoleDto })
  async updateMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupService.updateMemberRole(req.user.id, id, memberId, dto);
  }

  // =====================================================
  // JOIN LINK MANAGEMENT (INSTRUCTOR, owner only)
  // =====================================================

  @Post(':id/join-link')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(GroupDocs.generateJoinLink)
  async generateJoinLink(
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
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
    const member = await this.groupService.joinViaLink(token, req.user.id);
    // The group, so the app can open it (the web read `groupId` from here
    // and, without it, landed on the list).
    return { message: 'You have joined the group', groupId: member.groupId };
  }
}
