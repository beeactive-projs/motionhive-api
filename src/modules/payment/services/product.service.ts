import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';

import {
  Product,
  ProductInterval,
  ProductType,
} from '../entities/product.entity';
import { StripeService } from './stripe.service';
import {
  buildPaginatedResponse,
  getOffset,
  PaginatedResponse,
} from '../../../common/dto/pagination.dto';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';

/**
 * ProductService
 *
 * Owns the instructor's reusable price list. Each Product is mirrored to
 * Stripe as a Product + Price pair. Editing amount creates a NEW Price
 * (Stripe Prices are immutable) and updates the local pointer; the old
 * Price stays archived in Stripe so historical invoices keep resolving.
 */
@Injectable()
export class ProductService {
  constructor(
    @InjectModel(Product)
    private readonly productModel: typeof Product,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async create(instructorId: string, dto: CreateProductDto): Promise<Product> {
    if (
      dto.type === ProductType.SUBSCRIPTION &&
      (!dto.interval || !dto.intervalCount)
    ) {
      throw new ConflictException(
        'Subscription products require interval and intervalCount.',
      );
    }
    const currency = (dto.currency ?? 'RON').toLowerCase();

    const tx = await this.sequelize.transaction();
    try {
      // Insert local row first so we have a stable id for the idempotency key.
      const row = await this.productModel.create(
        {
          instructorId,
          name: dto.name,
          description: dto.description ?? null,
          type: dto.type,
          amountCents: dto.amountCents,
          currency: currency.toUpperCase(),
          interval: dto.interval ?? null,
          intervalCount: dto.intervalCount ?? null,
          stripeProductId: null,
          stripePriceId: null,
          isActive: true,
        },
        { transaction: tx },
      );

      const stripeProduct = await this.stripeService.stripe.products.create(
        {
          name: dto.name,
          description: dto.description ?? undefined,
          metadata: {
            beeactive_product_id: row.id,
            beeactive_instructor_id: instructorId,
          },
        },
        {
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'product',
            row.id,
            'create',
          ),
        },
      );

      const stripePrice = await this.stripeService.stripe.prices.create(
        {
          product: stripeProduct.id,
          unit_amount: dto.amountCents,
          currency,
          ...(dto.type === ProductType.SUBSCRIPTION && {
            recurring: {
              interval: dto.interval as ProductInterval,
              interval_count: dto.intervalCount,
            },
          }),
        },
        {
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'price',
            row.id,
            'create',
          ),
        },
      );

      row.stripeProductId = stripeProduct.id;
      row.stripePriceId = stripePrice.id;
      await row.save({ transaction: tx });

      await tx.commit();
      return row;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async listMine(
    instructorId: string,
    page: number,
    limit: number,
    type?: ProductType,
    isActive?: boolean,
  ): Promise<PaginatedResponse<Product>> {
    const where: Record<string, unknown> = { instructorId };
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive;
    const { rows, count } = await this.productModel.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async update(
    instructorId: string,
    productId: string,
    dto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.requireOwnedProduct(instructorId, productId);

    const tx = await this.sequelize.transaction();
    try {
      if (dto.name !== undefined) product.name = dto.name;
      if (dto.description !== undefined) {
        product.description = dto.description;
      }
      if (dto.isActive !== undefined) product.isActive = dto.isActive;

      // Amount change ⇒ create a new Stripe Price (immutable in Stripe).
      if (
        dto.amountCents !== undefined &&
        dto.amountCents !== product.amountCents
      ) {
        if (!product.stripeProductId) {
          throw new ConflictException(
            'Product is not linked to a Stripe product yet.',
          );
        }
        const newPrice = await this.stripeService.stripe.prices.create({
          product: product.stripeProductId,
          unit_amount: dto.amountCents,
          currency: product.currency.toLowerCase(),
          ...(product.type === ProductType.SUBSCRIPTION &&
            product.interval && {
              recurring: {
                interval: product.interval,
                interval_count: product.intervalCount ?? 1,
              },
            }),
        });
        // Archive the old Price so it doesn't show in dropdowns.
        if (product.stripePriceId) {
          await this.stripeService.stripe.prices
            .update(product.stripePriceId, { active: false })
            .catch((err) => {
              this.logger.warn(
                `Failed to archive old Stripe price ${product.stripePriceId}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
                'ProductService',
              );
            });
        }
        product.amountCents = dto.amountCents;
        product.stripePriceId = newPrice.id;
      }

      // Name/description sync to Stripe Product.
      if (
        product.stripeProductId &&
        (dto.name !== undefined || dto.description !== undefined)
      ) {
        await this.stripeService.stripe.products.update(
          product.stripeProductId,
          {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.description !== undefined && {
              description: dto.description ?? undefined,
            }),
          },
        );
      }

      await product.save({ transaction: tx });
      await tx.commit();
      return product;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async deactivate(instructorId: string, productId: string): Promise<void> {
    const product = await this.requireOwnedProduct(instructorId, productId);
    if (!product.isActive) return;
    product.isActive = false;
    await product.save();
    if (product.stripeProductId) {
      await this.stripeService.stripe.products
        .update(product.stripeProductId, { active: false })
        .catch((err) => {
          this.logger.warn(
            `Failed to deactivate Stripe product ${product.stripeProductId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
            'ProductService',
          );
        });
    }
  }

  private async requireOwnedProduct(
    instructorId: string,
    productId: string,
  ): Promise<Product> {
    const product = await this.productModel.findByPk(productId);
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    if (product.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this product.');
    }
    return product;
  }
}
