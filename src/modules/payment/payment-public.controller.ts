import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ProductService } from './services/product.service';

/**
 * Payment Public Controller
 *
 * Unauthenticated read-only endpoints that surface payment-related
 * data on public profile pages. Kept on its own controller so the
 * main PaymentController can stay fully guarded with AuthGuard; this
 * one has no @UseGuards on purpose — follows the same pattern as
 * ProfileController's public discover/instructor endpoints.
 */
@ApiTags('Payments (Public)')
@Controller('payments/public')
export class PaymentPublicController {
  constructor(private readonly productService: ProductService) {}

  /**
   * GET /payments/public/instructors/:id/products
   *
   * Returns products the instructor has explicitly opted to show on
   * their public profile (`showOnProfile = true`, `isActive = true`).
   * No pagination — this drives a small "Services / pricing" card.
   */
  @Get('instructors/:id/products')
  async listPublicProducts(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.productService.listPublicForInstructor(id);
  }
}
