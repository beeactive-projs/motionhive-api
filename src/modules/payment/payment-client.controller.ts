import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';

import { ApiEndpoint } from '../../common/decorators/api-response.decorator';
import { PaymentDocs } from '../../common/docs/payment.docs';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';

import { InvoiceService } from './services/invoice.service';
import { SubscriptionService } from './services/subscription.service';
import { CheckoutService } from './services/checkout.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@ApiTags('Payments (Client)')
@Controller('payments/my')
@UseGuards(AuthGuard('jwt'))
export class PaymentClientController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly subscriptionService: SubscriptionService,
    private readonly checkoutService: CheckoutService,
  ) {}

  @Get('invoices')
  @UseGuards(RolesGuard)
  @Roles('USER')
  @ApiEndpoint(PaymentDocs.myInvoices)
  async listMyInvoices(
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    return this.invoiceService.listForClient(
      req.user.id,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }

  @Get('invoices/:id')
  @UseGuards(RolesGuard)
  @Roles('USER')
  @ApiEndpoint(PaymentDocs.myInvoiceDetail)
  async getMyInvoice(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.invoiceService.getOneForUser(id, req.user.id);
  }

  @Get('invoices/:id/line-items')
  @UseGuards(RolesGuard)
  @Roles('USER')
  async getMyInvoiceLineItems(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.invoiceService.getLineItemsForUser(id, req.user.id);
  }

  @Post('invoices/:id/pay')
  @UseGuards(RolesGuard)
  @Roles('USER')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint({ ...PaymentDocs.payInvoice, body: CreateCheckoutDto })
  async payInvoice(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    const headers = req.headers as Record<
      string,
      string | string[] | undefined
    >;
    const uaHeader = headers['user-agent'];
    const userAgent = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
    const ip: string | undefined = req.ip;
    return this.checkoutService.createInvoiceCheckoutSession(
      id,
      req.user.id,
      dto,
      { ip, userAgent },
    );
  }

  @Post('setup-intent')
  @UseGuards(RolesGuard)
  @Roles('USER')
  @ApiEndpoint(PaymentDocs.customerSetupIntent)
  async createSetupIntent(@Request() req: AuthenticatedRequest) {
    return this.checkoutService.createSetupIntent(req.user.id);
  }

  @Post('portal-link')
  @UseGuards(RolesGuard)
  @Roles('USER')
  @ApiEndpoint(PaymentDocs.customerPortalLink)
  async getPortalLink(@Request() req: AuthenticatedRequest) {
    return this.checkoutService.createCustomerPortalLink(req.user.id);
  }

  @Get('subscriptions')
  @UseGuards(RolesGuard)
  @Roles('USER')
  @ApiEndpoint(PaymentDocs.mySubscriptions)
  async listMySubscriptions(
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    return this.subscriptionService.listForClient(
      req.user.id,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }

  /**
   * Client-initiated cancel — always at-period-end. The client keeps
   * access through the rest of the billing period they already paid
   * for. Idempotent: cancelling an already-scheduled subscription is
   * a no-op and returns the current state.
   */
  @Post('subscriptions/:id/cancel')
  @UseGuards(RolesGuard)
  @Roles('USER')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiEndpoint(PaymentDocs.cancelMySubscription)
  async cancelMySubscription(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.subscriptionService.cancelByClient(req.user.id, id);
  }

  /**
   * GET /payments/my/counts
   *
   * Lightweight count-only lookup for the profile tabs. Tells the
   * client how many invoices / memberships they have in total and
   * how many are actionable (open invoices, active memberships) so
   * badges can render without hydrating the full lists.
   */
  @Get('counts')
  @UseGuards(RolesGuard)
  @Roles('USER')
  async getMyCounts(@Request() req: AuthenticatedRequest): Promise<{
    invoices: { total: number; open: number };
    memberships: { total: number; active: number };
  }> {
    const [invoices, memberships] = await Promise.all([
      this.invoiceService.countForClient(req.user.id),
      this.subscriptionService.countForClient(req.user.id),
    ]);
    return { invoices, memberships };
  }
}
