import { NotFoundException } from '@nestjs/common';
import { Op } from 'sequelize';

import { apiError } from '../../../common/i18n';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../../client/entities/instructor-client.entity';

/**
 * A coach bills by account only someone who is or was their client: an
 * ACTIVE relationship, or an ARCHIVED one (an unpaid session from before it
 * ended). Anyone else is 404, as for a client they do not have, so the
 * route cannot be used to bill a stranger or to read their email back from
 * the invoice. Someone with no account is billed by email (`guestEmail`).
 */
export async function assertBillableClient(
  instructorId: string,
  clientId: string,
): Promise<void> {
  const link = await InstructorClient.findOne({
    where: {
      instructorId,
      clientId,
      status: {
        [Op.in]: [
          InstructorClientStatus.ACTIVE,
          InstructorClientStatus.ARCHIVED,
        ],
      },
    },
    attributes: ['id'],
  });
  if (!link?.id) {
    throw new NotFoundException(apiError('payment.clientNotFound'));
  }
}
