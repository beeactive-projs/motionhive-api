import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UniqueConstraintError } from 'sequelize';
import { Waitlist } from './entities/waitlist.entity';
import { CreateWaitlistDto } from './dto/create-waitlist.dto';

@Injectable()
export class WaitlistService {
  constructor(
    @InjectModel(Waitlist)
    private waitlistModel: typeof Waitlist,
  ) {}

  async create(dto: CreateWaitlistDto): Promise<Waitlist> {
    try {
      return await this.waitlistModel.create({ ...dto });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('This email is already on the waitlist');
      }
      throw error;
    }
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
