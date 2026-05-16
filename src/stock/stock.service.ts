import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { StockQueryDto } from './dto/stock-query.dto.js';
import { paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';
import { weightedAverageCostAfterPurchase } from '../common/store-product-wac.js';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  private generateBatchNumber(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `B-${ts}-${rand}`;
  }

  async createAdjustment(dto: CreateAdjustmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.create({
        data: {
          type: dto.type,
          reason: dto.reason,
          branchId: dto.branchId,
        },
      });

      for (const item of dto.items) {
        await tx.stockAdjustmentItem.create({
          data: {
            stockAdjustmentId: adjustment.id,
            storeProductId: item.storeProductId,
            quantity: item.quantity,
          },
        });

        if (dto.type === 'ADDITION') {
          await tx.storeProduct.update({
            where: { id: item.storeProductId },
            data: { quantity: { increment: item.quantity } },
          });

          const storeProduct = await tx.storeProduct.findUnique({
            where: { id: item.storeProductId },
          });

          const latestBatch = await tx.batch.findFirst({
            where: { storeProductId: item.storeProductId },
            orderBy: { createdAt: 'desc' },
          });
          const cost = latestBatch?.purchaseCost ?? new Prisma.Decimal(0);

          await tx.batch.create({
            data: {
              batchNumber: this.generateBatchNumber(),
              batchType: 'adjustment-add',
              initialQty: item.quantity,
              availableQty: item.quantity,
              purchaseCost: cost,
              totalCost: cost.mul(new Prisma.Decimal(item.quantity)),
              supplierId: latestBatch?.supplierId,
              storeProductId: item.storeProductId,
            },
          });
        } else {
          await tx.storeProduct.update({
            where: { id: item.storeProductId },
            data: { quantity: { decrement: item.quantity } },
          });

          let remaining = item.quantity;
          const batches = await tx.batch.findMany({
            where: {
              storeProductId: item.storeProductId,
              availableQty: { gt: 0 },
            },
            orderBy: { createdAt: 'desc' },
          });

          for (const batch of batches) {
            if (remaining <= 0) break;
            const deductQty = Math.min(batch.availableQty, remaining);
            await tx.batch.update({
              where: { id: batch.id },
              data: { availableQty: { decrement: deductQty } },
            });
            remaining -= deductQty;
          }
        }
      }

      return tx.stockAdjustment.findUnique({
        where: { id: adjustment.id },
        include: { items: true, branch: true },
      });
    });
  }

  async getAdjustments(query: StockQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      branchId,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (search) where.reason = { contains: search };

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          branch: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async createTransfer(dto: CreateTransferDto) {
    if (dto.fromBranchId === dto.toBranchId) {
      throw new BadRequestException(
        'Source and destination branches must differ',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.create({
        data: {
          fromBranchId: dto.fromBranchId,
          toBranchId: dto.toBranchId,
          note: dto.note,
          status: 'PENDING',
        },
      });

      for (const item of dto.items) {
        const sourceProduct = await tx.storeProduct.findUnique({
          where: { id: item.storeProductId },
        });
        if (!sourceProduct) {
          throw new NotFoundException(
            `StoreProduct #${item.storeProductId} not found`,
          );
        }
        if (sourceProduct.quantity < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for StoreProduct #${item.storeProductId}`,
          );
        }

        await tx.stockTransferItem.create({
          data: {
            stockTransferId: transfer.id,
            storeProductId: item.storeProductId,
            quantity: item.quantity,
          },
        });

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: { quantity: { decrement: item.quantity } },
        });

        // Deduct from latest batches at source
        let remaining = item.quantity;
        const sourceBatches = await tx.batch.findMany({
          where: {
            storeProductId: item.storeProductId,
            availableQty: { gt: 0 },
          },
          orderBy: { createdAt: 'desc' },
        });
        const latestCost =
          sourceBatches[0]?.purchaseCost ?? new Prisma.Decimal(0);

        for (const batch of sourceBatches) {
          if (remaining <= 0) break;
          const deductQty = Math.min(batch.availableQty, remaining);
          await tx.batch.update({
            where: { id: batch.id },
            data: { availableQty: { decrement: deductQty } },
          });
          remaining -= deductQty;
        }

        const unitMoved = new Prisma.Decimal(
          sourceProduct.averageCost,
        ).greaterThan(0)
          ? new Prisma.Decimal(sourceProduct.averageCost)
          : new Prisma.Decimal(latestCost);

        let destProduct = await tx.storeProduct.findFirst({
          where: {
            productId: sourceProduct.productId,
            productVariantId: sourceProduct.productVariantId,
            branchId: dto.toBranchId,
          },
        });

        if (!destProduct) {
          destProduct = await tx.storeProduct.create({
            data: {
              productId: sourceProduct.productId,
              productVariantId: sourceProduct.productVariantId,
              branchId: dto.toBranchId,
              quantity: 0,
              sellingPrice: sourceProduct.sellingPrice,
              averageCost: new Prisma.Decimal(0),
              discountType: sourceProduct.discountType,
              discountValue: sourceProduct.discountValue,
              quantityAlert: sourceProduct.quantityAlert,
              sellingType: sourceProduct.sellingType,
            },
          });
        }

        const destPrevQty = destProduct.quantity;
        const destPrevAvg = new Prisma.Decimal(destProduct.averageCost);
        const movedQ = item.quantity;
        const mergedAvg = weightedAverageCostAfterPurchase(
          destPrevQty,
          destPrevAvg,
          movedQ,
          unitMoved,
        );

        await tx.storeProduct.update({
          where: { id: destProduct.id },
          data: {
            quantity: { increment: movedQ },
            averageCost: mergedAvg.toDecimalPlaces(6),
          },
        });

        await tx.batch.create({
          data: {
            batchNumber: this.generateBatchNumber(),
            batchType: 'transfer',
            initialQty: item.quantity,
            availableQty: item.quantity,
            purchaseCost: unitMoved.toDecimalPlaces(2),
            totalCost: unitMoved.mul(new Prisma.Decimal(item.quantity)),
            storeProductId: destProduct.id,
          },
        });

      }

      return tx.stockTransfer.findUnique({
        where: { id: transfer.id },
        include: {
          items: true,
          fromBranch: true,
          toBranch: true,
        },
      });
    });
  }

  async getTransfers(query: StockQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      branchId,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) {
      where.OR = [{ fromBranchId: branchId }, { toBranchId: branchId }];
    }
    if (search) where.note = { contains: search };

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          fromBranch: true,
          toBranch: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async completeTransfer(id: number) {
    const transfer = await this.prisma.stockTransfer.findUnique({
      where: { id },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'PENDING') {
      throw new BadRequestException('Transfer is not in PENDING status');
    }

    return this.prisma.stockTransfer.update({
      where: { id },
      data: { status: 'COMPLETED' },
      include: {
        items: true,
        fromBranch: true,
        toBranch: true,
      },
    });
  }

  async getStockReport(branchId: number) {
    const storeProducts = await this.prisma.storeProduct.findMany({
      where: { branchId },
      include: {
        product: {
          include: {
            images: { take: 1, orderBy: { sortOrder: 'asc' } },
          },
        },
        productVariant: {
          include: {
            attributes: { include: { attributeValue: true } },
          },
        },
        batches: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { product: { name: 'asc' } },
    });

    return storeProducts;
  }
}
