import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NoImpersonationGuard } from '../../common/guards/no-impersonation.guard';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { apiError } from '../../common/i18n';
import { DeviceDocs } from '../../common/docs/notification.docs';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { DeviceTokenService } from './services/device-token.service';
import { DevicePlatform } from './entities/device-token.entity';
import { RegisterDeviceDto } from './dto/register-device.dto';

/**
 * DeviceController — push registration storage.
 *
 * In Phase 3 the table is read by no worker yet (the push worker
 * lands later). Endpoints exist now so the FE can wire its
 * registration flow once and we don't have to change the contract
 * later.
 */
@ApiTags('Devices')
@Controller('devices')
@UseGuards(AuthGuard('jwt'), NoImpersonationGuard)
export class DeviceController {
  constructor(private readonly devices: DeviceTokenService) {}

  /**
   * Throttled because a misbehaving FE could call this on every
   * navigation. 60/min is generous; real flows hit it once per login
   * + occasional refresh.
   */
  @Post('register')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiEndpoint(DeviceDocs.register)
  register(
    @Request() req: AuthenticatedRequest,
    @Body() dto: RegisterDeviceDto,
  ) {
    // The DTO's @ValidateIf guards already ensure the right field is
    // present per platform — but a runtime check is defense-in-depth
    // against future DTO refactors that could regress the guarantee.
    const token =
      dto.platform === DevicePlatform.WEB ? dto.subscription : dto.tokenString;
    if (!token) {
      throw new BadRequestException(
        apiError('notification.deviceTokenMissing'),
      );
    }
    return this.devices.register({
      userId: req.user.id,
      platform: dto.platform,
      token,
      deviceLabel: dto.deviceLabel,
    });
  }

  @Get()
  @ApiEndpoint(DeviceDocs.list)
  list(@Request() req: AuthenticatedRequest) {
    return this.devices.listActiveForUser(req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint(DeviceDocs.revoke)
  revoke(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.devices.revoke(req.user.id, id);
  }

  @Patch(':id/seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiEndpoint(DeviceDocs.heartbeat)
  heartbeat(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.devices.bumpLastSeen(req.user.id, id);
  }
}
