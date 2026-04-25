import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { WaitlistDocs } from '../../common/docs/waitlist.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Post()
  @Throttle({ default: { limit: 7, ttl: 900_000 } })
  @ApiEndpoint(WaitlistDocs.create)
  async create(@Body() dto: CreateWaitlistDto) {
    return this.waitlistService.create(dto);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiEndpoint(WaitlistDocs.list)
  async findAll() {
    return this.waitlistService.findAll();
  }

  @Get('count')
  @ApiEndpoint(WaitlistDocs.count)
  async count() {
    const total = await this.waitlistService.count();
    return { total };
  }
}
