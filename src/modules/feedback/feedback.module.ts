import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Feedback } from './entities/feedback.entity';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { RoleModule } from '../role/role.module';

@Module({
  imports: [SequelizeModule.forFeature([Feedback]), RoleModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
