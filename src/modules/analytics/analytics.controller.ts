import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * Analytics Controller
 *
 * Provides analytics endpoints:
 * - GET /analytics/instructor/summary  → Instructor's key metrics (30 days)
 * - GET /analytics/me/activity          → User's own activity summary
 * - GET /analytics/admin/platform       → Platform-wide stats (ADMIN+)
 */
@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(AuthGuard('jwt'))
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('instructor/summary')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({
    summary: 'Instructor summary',
    description:
      'Key metrics for the last 30 days: sessions, attendance rate, clients, groups.',
    auth: true,
    responses: [{ status: 200, description: 'Instructor analytics summary' }],
  })
  async getInstructorSummary(@Request() req) {
    return this.analyticsService.getInstructorSummary(req.user.id);
  }

  @Get('me/activity')
  @ApiEndpoint({
    summary: 'My activity',
    description:
      'User activity summary for the last 30 days: attended sessions, attendance rate, groups.',
    auth: true,
    responses: [{ status: 200, description: 'User activity summary' }],
  })
  async getUserActivity(@Request() req) {
    return this.analyticsService.getUserActivity(req.user.id);
  }

  @Get('admin/platform')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint({
    summary: 'Platform statistics',
    description: 'Platform-wide stats: users, instructors, groups, sessions. Admin only.',
    auth: true,
    responses: [{ status: 200, description: 'Platform statistics' }],
  })
  async getPlatformStats() {
    return this.analyticsService.getPlatformStats();
  }
}
