import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { AccountDeletionDocs } from '../../common/docs/account-deletion.docs';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AccountDeletionService } from './account-deletion.service';
import { ConfirmAccountDeletionDto } from './dto/confirm-account-deletion.dto';

/**
 * Deleting your own account: see what it would end, get a code, confirm.
 * Keeping it during the cooling-off happens at sign-in (POST
 * /auth/restore-account), since the account is signed out by then.
 */
@ApiTags('Account deletion')
@Controller('users/me/deletion')
@UseGuards(AuthGuard('jwt'))
export class AccountDeletionController {
  constructor(
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  @Get('preview')
  @ApiEndpoint(AccountDeletionDocs.preview)
  async preview(@Request() req: AuthenticatedRequest) {
    return this.accountDeletionService.preview(req.user);
  }

  @Post('code')
  @HttpCode(200)
  // Each call emails the account; three in a quarter hour is plenty for a
  // lost or slow email.
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @ApiEndpoint(AccountDeletionDocs.sendCode)
  async sendCode(@Request() req: AuthenticatedRequest) {
    return this.accountDeletionService.sendCode(req.user);
  }

  @Post('confirm')
  @HttpCode(200)
  // The code itself allows five tries; this caps hammering across codes.
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @ApiEndpoint({
    ...AccountDeletionDocs.confirm,
    body: ConfirmAccountDeletionDto,
  })
  async confirm(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ConfirmAccountDeletionDto,
  ) {
    return this.accountDeletionService.confirm(req.user, dto.code);
  }
}
