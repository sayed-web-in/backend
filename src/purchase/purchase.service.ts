import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePurchaseDto } from './dto/create-purchase.dto.js';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto.js';
import { PurchaseQueryDto } from './dto/purchase-query.dto.js';
import { paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class PurchaseService {
  constructor(private prisma: PrismaService) {}

  private generateReferenceNo(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `PUR-${ts}-${rand}`;
  }

  private generateBatchNumber(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `B-${ts}-${rand}`;
  }

  async create(dto: CreatePurchaseDto) {
    return this.prisma.$transaction(async (tx) => {
      const referenceNo = this.generateReferenceNo();

      let totalAmount = new Prisma.Decimal(0);
      for (const item of dto.items) {
        totalAmount = totalAmount.add(
          new Prisma.Decimal(item.unitCost).mul(new Prisma.Decimal(item.quantity)),
        );
      }

      const discount = new Prisma.Decimal(dto.discount ?? 0);
      const tax = new Prisma.Decimal(dto.tax ?? 0);
      const grandTotal = totalAmount.sub(discount).add(tax);
      const paidAmount = new Prisma.Decimal(dto.paidAmount);
      const dueAmount = grandTotal.sub(paidAmount).greaterThan(0)
        ? grandTotal.sub(paidAmount)
        : new Prisma.Decimal(0);

      const status = dueAmount.greaterThan(0) ? 'PARTIAL' : 'RECEIVED';

      const purchase = await tx.purchase.create({
        data: {
          referenceNo,
          supplierId: dto.supplierId,
          branchId: dto.branchId,
          totalAmount,
          discount,
          tax,
          grandTotal,
          paidAmount,
          dueAmount,
          paymentMethod: dto.paymentMethod,
          paymentAccountId: dto.paymentAccountId,
          status,
          note: dto.note,
        },
      });

      for (const item of dto.items) {
        const itemTotal = new Prisma.Decimal(item.unitCost).mul(
          new Prisma.Decimal(item.quantity),
        );

        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            storeProductId: item.storeProductId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            total: itemTotal,
          },
        });

        const storeProduct = await tx.storeProduct.findUnique({
          where: { id: item.storeProductId },
        });
        if (!storeProduct) {
          throw new NotFoundException(
            `StoreProduct #${item.storeProductId} not found`,
          );
        }

        // Weighted average cost: ((existingQty * existingAvgCost) + (newQty * cost)) / totalQty
        const existingBatches = await tx.batch.findMany({
          where: { storeProductId: item.storeProductId, availableQty: { gt: 0 } },
        });
        let existingTotalCost = new Prisma.Decimal(0);
        let existingTotalQty = 0;
        for (const b of existingBatches) {
          existingTotalCost = existingTotalCost.add(
            b.purchaseCost.mul(new Prisma.Decimal(b.availableQty)),
          );
          existingTotalQty += b.availableQty;
        }
        const newTotalQty = existingTotalQty + item.quantity;
        const _weightedAvgCost = newTotalQty > 0
          ? existingTotalCost
              .add(new Prisma.Decimal(item.unitCost).mul(new Prisma.Decimal(item.quantity)))
              .div(new Prisma.Decimal(newTotalQty))
          : new Prisma.Decimal(item.unitCost);

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: { quantity: { increment: item.quantity } },
        });

        const batch = await tx.batch.create({
          data: {
            batchNumber: this.generateBatchNumber(),
            batchType: 'purchase',
            initialQty: item.quantity,
            availableQty: item.quantity,
            purchaseCost: item.unitCost,
            totalCost: itemTotal,
            supplierId: dto.supplierId,
            storeProductId: item.storeProductId,
          },
        });

        if (item.serialNumbers?.length) {
          await tx.serialNumber.createMany({
            data: item.serialNumbers.map((serial) => ({
              serial,
              status: 'IN_STOCK' as const,
              batchId: batch.id,
            })),
          });
        }
      }

      if (dto.paymentAccountId && paidAmount.greaterThan(0)) {
        await tx.transaction.create({
          data: {
            accountId: dto.paymentAccountId,
            type: 'DEBIT',
            amount: paidAmount,
            reference: referenceNo,
            description: `Purchase payment - ${referenceNo}`,
          },
        });

        await tx.account.update({
          where: { id: dto.paymentAccountId },
          data: { balance: { decrement: paidAmount } },
        });
      }

      if (dto.supplierId && dueAmount.greaterThan(0)) {
        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { totalDue: { increment: dueAmount } },
        });
      }

      return tx.purchase.findUnique({
        where: { id: purchase.id },
        include: {
          items: {
            include: {
              storeProduct: {
                include: { product: true, productVariant: true },
              },
            },
          },
          supplier: true,
          branch: true,
          paymentAccount: true,
        },
      });
    });
  }

  async findAll(query: PurchaseQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      branchId,
      supplierId,
      status,
      dateFrom,
      dateTo,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;
    if (search) {
      where.referenceNo = { contains: search };
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          supplier: true,
          branch: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        supplier: true,
        branch: true,
        paymentAccount: true,
        items: {
          include: {
            storeProduct: {
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
              },
            },
          },
        },
        returns: {
          include: { items: true },
        },
      },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    return purchase;
  }

  async createReturn(dto: CreatePurchaseReturnDto) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: dto.purchaseId },
      include: { items: true },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');

    return this.prisma.$transaction(async (tx) => {
      let returnTotal = new Prisma.Decimal(0);
      const returnItemsData = dto.items.map((item) => {
        const itemTotal = new Prisma.Decimal(item.unitCost).mul(
          new Prisma.Decimal(item.quantity),
        );
        returnTotal = returnTotal.add(itemTotal);
        return {
          storeProductId: item.storeProductId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          total: itemTotal,
        };
      });

      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          purchaseId: dto.purchaseId,
          reason: dto.reason,
          totalAmount: returnTotal,
          items: { create: returnItemsData },
        },
        include: { items: true },
      });

      for (const item of dto.items) {
        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: { quantity: { decrement: item.quantity } },
        });

        const batch = await tx.batch.findFirst({
          where: { storeProductId: item.storeProductId },
          orderBy: { createdAt: 'desc' },
        });

        if (batch) {
          const restoreQty = Math.min(batch.availableQty, item.quantity);
          await tx.batch.update({
            where: { id: batch.id },
            data: {
              availableQty: { decrement: restoreQty },
              returnQty: { increment: restoreQty },
            },
          });
        }
      }

      const allReturnedQty = await this.getTotalReturnedQuantities(
        tx,
        dto.purchaseId,
      );
      const allReturned = purchase.items.every((pi) => {
        const returned = allReturnedQty.get(pi.storeProductId) ?? 0;
        return returned >= pi.quantity;
      });

      await tx.purchase.update({
        where: { id: dto.purchaseId },
        data: { status: allReturned ? 'RETURNED' : 'PARTIAL' },
      });

      if (purchase.paymentAccountId) {
        await tx.transaction.create({
          data: {
            accountId: purchase.paymentAccountId,
            type: 'CREDIT',
            amount: returnTotal,
            reference: purchase.referenceNo,
            description: `Purchase return - ${purchase.referenceNo}`,
          },
        });

        await tx.account.update({
          where: { id: purchase.paymentAccountId },
          data: { balance: { increment: returnTotal } },
        });
      }

      if (purchase.supplierId) {
        await tx.supplier.update({
          where: { id: purchase.supplierId },
          data: { totalDue: { decrement: returnTotal } },
        });
      }

      return purchaseReturn;
    });
  }

  private async getTotalReturnedQuantities(
    tx: Prisma.TransactionClient,
    purchaseId: number,
  ): Promise<Map<number, number>> {
    const returns = await tx.purchaseReturn.findMany({
      where: { purchaseId },
      include: { items: true },
    });

    const map = new Map<number, number>();
    for (const ret of returns) {
      for (const item of ret.items) {
        map.set(
          item.storeProductId,
          (map.get(item.storeProductId) ?? 0) + item.quantity,
        );
      }
    }
    return map;
  }

  async getPurchaseProducts(query: PurchaseQueryDto) {
    const {
      page = 1,
      limit = 16,
      branchId,
      dateFrom,
      dateTo,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) {
      where.purchase = { branchId };
    }
    if (dateFrom || dateTo) {
      where.purchase = { ...where.purchase, createdAt: {} };
      if (dateFrom) where.purchase.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.purchase.createdAt.lte = new Date(dateTo);
    }
    if (search) {
      where.storeProduct = {
        product: { name: { contains: search } },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.purchaseItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: {
          purchase: { include: { supplier: true, branch: true } },
          storeProduct: {
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
            },
          },
        },
      }),
      this.prisma.purchaseItem.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }
}
