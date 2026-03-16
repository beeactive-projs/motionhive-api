import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Feedback } from './entities/feedback.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback)
    private feedbackModel: typeof Feedback,
  ) {}

  async create(dto: CreateFeedbackDto): Promise<Feedback> {
    return this.feedbackModel.create({ ...dto });
  }

  async findAll(): Promise<Feedback[]> {
    return this.feedbackModel.findAll({
      order: [['createdAt', 'DESC']],
    });
  }
}
