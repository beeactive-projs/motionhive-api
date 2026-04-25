import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { FeedbackDocs } from '../../common/docs/feedback.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { Request as ExpressRequest } from 'express';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';

/**
 * `req.user` shape we accept on the public feedback endpoint. When a
 * JWT is present we attach the submitter's id to the feedback row for
 * audit trail; without a JWT the endpoint still accepts the request
 * (anonymous feedback from the marketing site). This is why we can't
 * use the strict `AuthenticatedRequest` type here.
 */
type MaybeAuthedRequest = ExpressRequest & { user?: AuthenticatedUser };

@ApiTags('Feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /**
   * Public endpoint — accepts feedback from both authenticated users
   * and anonymous website visitors. Rate-limited per IP. `userId` is
   * NEVER read from the body; when the caller is authenticated we
   * attach it server-side.
   */
  @Post()
  @Throttle({ default: { limit: 7, ttl: 900_000 } })
  @ApiEndpoint(FeedbackDocs.create)
  async create(@Req() req: MaybeAuthedRequest, @Body() dto: CreateFeedbackDto) {
    return this.feedbackService.create(dto, req.user?.id ?? null);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(FeedbackDocs.list)
  async findAll() {
    return this.feedbackService.findAll();
  }
}
