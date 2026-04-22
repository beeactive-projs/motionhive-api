import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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

import { ConnectService } from './services/connect.service';
import { ProductService } from './services/product.service';
import { InvoiceService } from './services/invoice.service';
import { SubscriptionService } from './services/subscription.service';
import { RefundService } from './services/refund.service';
import { EarningsService } from './services/earnings.service';
import { OnboardingStartDto } from './dto/onboarding-start.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { SendInvoiceDto } from './dto/send-invoice.dto';
import { ListSubscriptionsQueryDto } from './dto/list-subscriptions.query.dto';
import {
  CreateSubscriptionDto,
  CancelSubscriptionDto,
} from './dto/create-subscription.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices.query.dto';
import { ListProductsQueryDto } from './dto/list-products.query.dto';

/**
 * PaymentController — instructor-facing payment endpoints.
 *
 * Phase 2 (this commit):
 *   POST /payments/onboarding/start
 *   GET  /payments/onboarding/status
 *   POST /payments/onboarding/dashboard-link
 *
 * Phase 3+ will extend this controller with products, invoices, refunds,
 * earnings. The client-facing routes live in PaymentClientController.
 *
 * All routes require a JWT and the INSTRUCTOR role. Admins are NOT given
 * blanket access on purpose — onboarding is per-user and an admin signing
 * in to "fix" an instructor's account should always go through the Stripe
 * Express Dashboard, not this controller.
 */
@ApiTags('Payments')
@Controller('payments')
@UseGuards(AuthGuard('jwt'))
export class PaymentController {
  constructor(
    private readonly connectService: ConnectService,
    private readonly productService: ProductService,
    private readonly invoiceService: InvoiceService,
    private readonly subscriptionService: SubscriptionService,
    private readonly refundService: RefundService,
    private readonly earningsService: EarningsService,
  ) {}

  // ===================================================================
  // ONBOARDING
  // ===================================================================

  @Post('onboarding/start')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  // Hosted onboarding link generation hits Stripe; cap at 5/hour to keep a
  // confused user clicking the button from racking up Stripe API calls.
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiEndpoint({ ...PaymentDocs.onboardingStart, body: OnboardingStartDto })
  async startOnboarding(
    @Request() req: AuthenticatedRequest,
    @Body() dto: OnboardingStartDto,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.connectService.createOnboardingLink(req.user.id, {
      returnUrl: dto.returnUrl,
      refreshUrl: dto.refreshUrl,
    });
  }

  @Get('onboarding/status')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint(PaymentDocs.onboardingStatus)
  async getOnboardingStatus(@Request() req: AuthenticatedRequest) {
    return this.connectService.getStatus(req.user.id);
  }

  @Post('onboarding/dashboard-link')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  // Express Dashboard login links are short-lived; FE flow is "click button →
  // open new tab". 10/hour is generous and still rate-limits a stuck client.
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiEndpoint(PaymentDocs.onboardingDashboardLink)
  async getDashboardLink(@Request() req: AuthenticatedRequest) {
    return this.connectService.createDashboardLink(req.user.id);
  }

  // ===================================================================
  // PRODUCTS
  // ===================================================================

  @Post('products')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint({ ...PaymentDocs.createProduct, body: CreateProductDto })
  async createProduct(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateProductDto,
  ) {
    return this.productService.create(req.user.id, dto);
  }

  @Get('products')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint(PaymentDocs.listProducts)
  async listProducts(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.productService.listMine(
      req.user.id,
      query.page ?? 1,
      query.limit ?? 20,
      query.type,
      query.isActive,
    );
  }

  @Patch('products/:id')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint({ ...PaymentDocs.updateProduct, body: UpdateProductDto })
  async updateProduct(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productService.update(req.user.id, id, dto);
  }

  @Delete('products/:id')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @HttpCode(204)
  @ApiEndpoint(PaymentDocs.deleteProduct)
  async deleteProduct(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.productService.deactivate(req.user.id, id);
  }

  // ===================================================================
  // INVOICES
  // ===================================================================

  @Post('invoices')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint({ ...PaymentDocs.createInvoice, body: CreateInvoiceDto })
  async createInvoice(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoiceService.createOneOff(req.user.id, dto);
  }

  @Get('invoices')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint(PaymentDocs.listInvoices)
  async listInvoices(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListInvoicesQueryDto,
  ) {
    return this.invoiceService.listMine(
      req.user.id,
      query.page ?? 1,
      query.limit ?? 20,
      query.status,
    );
  }

  @Get('invoices/:id')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint(PaymentDocs.getInvoice)
  async getInvoice(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.invoiceService.getOneForUser(id, req.user.id);
  }

  @Get('invoices/:id/line-items')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  async getInvoiceLineItems(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.invoiceService.getLineItemsForUser(id, req.user.id);
  }

  @Post('invoices/:id/send')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint(PaymentDocs.sendInvoice)
  async sendInvoice(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SendInvoiceDto,
  ) {
    return this.invoiceService.sendInvoice(req.user.id, id, body.overrideEmail);
  }

  @Post('invoices/:id/void')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint(PaymentDocs.voidInvoice)
  async voidInvoice(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.invoiceService.voidInvoice(req.user.id, id);
  }

  @Post('invoices/:id/mark-paid')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint(PaymentDocs.markInvoicePaid)
  async markInvoicePaid(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.invoiceService.markPaidOutOfBand(req.user.id, id);
  }

  // ===================================================================
  // SUBSCRIPTIONS
  // ===================================================================

  @Post('subscriptions')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiEndpoint({
    ...PaymentDocs.createSubscription,
    body: CreateSubscriptionDto,
  })
  async createSubscription(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subscriptionService.create(req.user.id, dto);
  }

  @Get('subscriptions')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint(PaymentDocs.listSubscriptions)
  async listSubscriptions(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListSubscriptionsQueryDto,
  ) {
    return this.subscriptionService.listForInstructor(
      req.user.id,
      query.page ?? 1,
      query.limit ?? 20,
      query.status,
    );
  }

  @Post('subscriptions/:id/cancel')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint({
    ...PaymentDocs.cancelSubscription,
    body: CancelSubscriptionDto,
  })
  async cancelSubscription(
    @Request() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptionService.cancel(
      req.user.id,
      id,
      dto.immediate ?? false,
    );
  }

  // ===================================================================
  // REFUNDS
  // ===================================================================

  @Post('refunds')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiEndpoint({ ...PaymentDocs.createRefund, body: CreateRefundDto })
  async createRefund(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateRefundDto,
  ) {
    return this.refundService.createRefund(req.user.id, dto);
  }

  // ===================================================================
  // EARNINGS
  // ===================================================================

  @Get('earnings')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint(PaymentDocs.getEarnings)
  async getEarnings(@Request() req: AuthenticatedRequest) {
    return this.earningsService.getSummary(req.user.id);
  }

  @Get('payments')
  @UseGuards(RolesGuard)
  @Roles('INSTRUCTOR')
  @ApiEndpoint(PaymentDocs.listPayments)
  async listPayments(
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    return this.earningsService.listPayments(
      req.user.id,
      pagination.page ?? 1,
      pagination.limit ?? 20,
    );
  }
}
