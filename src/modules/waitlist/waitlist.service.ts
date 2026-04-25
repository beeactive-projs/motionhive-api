import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { UniqueConstraintError } from 'sequelize';
import { Waitlist } from './entities/waitlist.entity';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';
import { EmailService } from '../../common/services/email.service';
import { EmailVerifierService } from '../../common/services/email-verifier.service';

@Injectable()
export class WaitlistService {
  constructor(
    @InjectModel(Waitlist)
    private waitlistModel: typeof Waitlist,
    private emailService: EmailService,
    private emailVerifier: EmailVerifierService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async create(dto: CreateWaitlistDto): Promise<Waitlist> {
    // Cheap deliverability check before we burn an email send or a DB row.
    // Throws BadRequestException on disposable domain / no-MX.
    await this.emailVerifier.assertDeliverable(dto.email);

    let entry: Waitlist;
    try {
      entry = await this.waitlistModel.create({ ...dto });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        // Already on the waitlist — return existing entry silently.
        // Do NOT re-send the confirmation email here: re-POSTing the
        // same address would otherwise let an attacker use this
        // endpoint to repeatedly email any address they pick.
        const existing = await this.waitlistModel.findOne({
          where: { email: dto.email },
        });
        if (!existing) {
          // Shouldn't happen — the unique constraint just fired on this
          // exact email — but if a race or multi-column unique lands us
          // here, surface a clean 500 rather than crash on a null deref.
          throw error;
        }
        return existing;
      }
      throw error;
    }

    // First-time signup — fire-and-forget confirmation.
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
