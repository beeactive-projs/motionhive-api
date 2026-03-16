import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Waitlist } from './entities/waitlist.entity';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { RoleModule } from '../role/role.module';
import { EmailService } from '../../common/services/email.service';

@Module({
  imports: [SequelizeModule.forFeature([Waitlist]), RoleModule],
  controllers: [WaitlistController],
  providers: [WaitlistService, EmailService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
