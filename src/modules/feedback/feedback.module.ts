import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Feedback } from './entities/feedback.entity';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { RoleModule } from '../role/role.module';
import { EmailService } from '../../common/services/email.service';

@Module({
  imports: [SequelizeModule.forFeature([Feedback]), RoleModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, EmailService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
