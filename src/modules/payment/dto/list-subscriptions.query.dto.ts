import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { SubscriptionStatus } from '../entities/subscription.entity';

export class ListSubscriptionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: SubscriptionStatus,
    description: 'Filter by Stripe subscription status',
  })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;
}
