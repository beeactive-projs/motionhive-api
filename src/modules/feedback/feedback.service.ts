import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Feedback } from './entities/feedback.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { EmailService } from '../../common/services/email.service';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectModel(Feedback)
    private feedbackModel: typeof Feedback,
    private emailService: EmailService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Store a feedback entry and optionally send a confirmation email.
   *
   * The confirmation only goes to the `email` the submitter entered
   * (NOT to an arbitrary user id looked up server-side). This closes
   * a previous amplification vector where an attacker could POST with
   * any `userId` and trigger a MotionHive-branded mail to that user.
   *
   * `userId` is attached server-side by the controller when the
   * request is authenticated — never from the request body.
   */
  async create(
    dto: CreateFeedbackDto,
    userId: string | null,
  ): Promise<Feedback> {
    const entry = await this.feedbackModel.create({
      type: dto.type,
      title: dto.title,
      message: dto.message,
      email: dto.email ?? null,
      userId,
    });

    if (dto.email) {
      this.emailService
        .sendFeedbackConfirmation(dto.email, dto.type, dto.title)
        .catch((err: unknown) =>
          this.logger.error(
            `Failed to send feedback confirmation to ${dto.email}: ${(err as Error).message}`,
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
