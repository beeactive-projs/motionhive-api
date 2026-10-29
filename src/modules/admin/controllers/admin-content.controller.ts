import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { ApiEndpoint } from '../../../common/decorators/api-response.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RawContent } from '../../../common/decorators/raw-content.decorator';
import { AdminDocs } from '../../../common/docs/admin.docs';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request';
import { AdminContentService } from '../services/admin-content.service';
import { AdminListDto } from '../dto/admin-list.dto';
import {
  ListWorkoutReportsDto,
  ResolveWorkoutReportDto,
} from '../../workout/dto/resolve-workout-report.dto';
import { sendPrivateImage } from '../../workout/workout-photo.http';

/** Content moderation. Read ADMIN/SUPPORT+; delete ADMIN/SUPER_ADMIN. */
@ApiTags('Admin — Content')
@RawContent()
@Controller('admin/content')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN', 'SUPPORT')
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get('posts')
  @ApiEndpoint(AdminDocs.listPosts)
  posts(@Query() q: AdminListDto) {
    return this.content.listPosts(q);
  }

  @Delete('posts/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(AdminDocs.deletePost)
  deletePost(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.content.deletePost(req.user.id, id, req.ip ?? null);
  }

  @Get('workout-reports')
  @ApiEndpoint(AdminDocs.listWorkoutReports)
  workoutReports(@Query() q: ListWorkoutReportsDto) {
    return this.content.listWorkoutReports(q);
  }

  @Patch('workout-reports/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(AdminDocs.resolveWorkoutReport)
  resolveWorkoutReport(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveWorkoutReportDto,
  ) {
    return this.content.resolveWorkoutReport(
      req.user.id,
      id,
      dto,
      req.ip ?? null,
    );
  }

  @Get('workout-reports/:id/photo')
  @ApiEndpoint(AdminDocs.workoutReportPhoto)
  async workoutReportPhoto(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const jpeg = await this.content.workoutReportPhoto(
      req.user.id,
      id,
      req.ip ?? null,
    );
    sendPrivateImage(res, jpeg);
  }

  @Get('reviews')
  @ApiEndpoint(AdminDocs.listReviews)
  reviews(@Query() q: AdminListDto) {
    return this.content.listReviews(q);
  }

  @Get('feedback')
  @ApiEndpoint(AdminDocs.listFeedback)
  feedback(@Query() q: AdminListDto) {
    return this.content.listFeedback(q);
  }

  @Get('waitlist')
  @ApiEndpoint(AdminDocs.listWaitlist)
  waitlist(@Query() q: AdminListDto) {
    return this.content.listWaitlist(q);
  }

  @Delete('reviews/:id')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(AdminDocs.deleteReview)
  deleteReview(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.content.deleteReview(req.user.id, id, req.ip ?? null);
  }
}
