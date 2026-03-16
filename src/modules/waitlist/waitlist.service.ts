import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { UniqueConstraintError } from 'sequelize';
import { Waitlist } from './entities/waitlist.entity';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { EmailService } from '../../common/services/email.service';

@Injectable()
export class WaitlistService {
  constructor(
    @InjectModel(Waitlist)
    private waitlistModel: typeof Waitlist,
    private emailService: EmailService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async create(dto: CreateWaitlistDto): Promise<Waitlist> {
    let entry: Waitlist;
    try {
      entry = await this.waitlistModel.create({ ...dto });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        // Already on the waitlist — return existing entry silently
        const existing = await this.waitlistModel.findOne({
          where: { email: dto.email },
        });

        // Re-send confirmation email
        const name = dto.name || existing?.name || undefined;
        this.emailService
          .sendWaitlistConfirmation(dto.email, name)
          .catch((err: Error) =>
            this.logger.error(
              `Failed to send waitlist confirmation to ${dto.email}: ${err.message}`,
              'WaitlistService',
            ),
          );

        return existing!;
      }
      throw error;
    }

    // Send confirmation email (fire-and-forget)
    this.emailService
      .sendWaitlistConfirmation(dto.email, dto.name)
      .catch((err: Error) =>
        this.logger.error(
          `Failed to send waitlist confirmation to ${dto.email}: ${err.message}`,
          'WaitlistService',
        ),
      );

    return entry;
  }

  async findAll(): Promise<Waitlist[]> {
    return this.waitlistModel.findAll({
      order: [['createdAt', 'DESC']],
    });
  }

  async count(): Promise<number> {
    return this.waitlistModel.count();
  }
}
