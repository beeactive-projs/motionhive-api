import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, MaxLength } from 'class-validator';

/**
 * Body for `POST /payments/invoices/:id/send`.
 *
 * When `overrideEmail` is provided, the invoice email is delivered by our
 * own Resend transport to that address (the Stripe-native send endpoint
 * emails the customer's on-file address, which doesn't let the instructor
 * pick a different recipient on a per-send basis).
 */
export class SendInvoiceDto {
  @ApiPropertyOptional({
    example: 'accountant@client.com',
    description:
      'Deliver this send to a different email than the one on file. ' +
      'Leave empty to send to the customer as recorded on the invoice.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  overrideEmail?: string;
}
