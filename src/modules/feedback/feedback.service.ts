import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Feedback } from './entities/feedback.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { EmailService } from '../../common/services/email.service';
import { UserService } from '../user/user.service';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback)
    private feedbackModel: typeof Feedback,
    private emailService: EmailService,
    private userService: UserService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async create(dto: CreateFeedbackDto): Promise<Feedback> {
    const entry = await this.feedbackModel.create({ ...dto });

    // Resolve email: direct email → userId lookup → skip
    let recipientEmail = dto.email;
    let recipientName: string | undefined;

    if (!recipientEmail && dto.userId) {
      try {
        const user = await this.userService.findById(dto.userId);
        if (user) {
          recipientEmail = user.email;
          recipientName = user.firstName;
        }
      } catch (err) {
        this.logger.warn(
          `Could not look up user ${dto.userId} for feedback confirmation: ${(err as Error).message}`,
          'FeedbackService',
        );
      }
    }

    if (recipientEmail) {
      this.emailService
        .sendFeedbackConfirmation(
          recipientEmail,
          dto.type,
          dto.title,
          recipientName,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to send feedback confirmation to ${recipientEmail}: ${err.message}`,
            'FeedbackService',
          ),
        );
    }

    return entry;
  }

  async findAll(): Promise<Feedback[]> {
    return this.feedbackModel.findAll({
      order: [['createdAt', 'DESC']],
    });
  }
}
