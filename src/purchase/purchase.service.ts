import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePurchaseDto } from './dto/create-purchase.dto.js';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto.js';
import { PurchaseQueryDto } from './dto/purchase-query.dto.js';
import { paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';
import { bdDayEndUtc, bdDayStartUtc } from '../common/bd-time.js';

@Injectable()
export class PurchaseService {
  constructor(private prisma: PrismaService) {}

  private purchaseWhereFromDto(query: PurchaseQueryDto) {
    const { branchId, supplierId, status, search, dateFrom, dateTo } = query;
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { referenceNo: { contains: search } },
        { supplier: { name: { contains: search } } },
      ];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.createdAt.lte = bdDayEndUtc(dateTo);
    }
    return where;
  }

  private purchaseReturnWhereFromDto(query: PurchaseQueryDto) {
    const { branchId, search, dateFrom, dateTo, supplierId } = query;
    const parts: any[] = [];
    if (branchId) parts.push({ purchase: { branchId } });
    if (supplierId) parts.push({ purchase: { supplierId } });
    if (search) {
      parts.push({
        OR: [
          { reason: { contains: search } },
          { purchase: { referenceNo: { contains: search } } },
          { purchase: { supplier: { name: { contains: search } } } },
        ],
      });
    }
    if (dateFrom || dateTo) {
      const range: any = {};
      if (dateFrom) range.gte = bdDayStartUtc(dateFrom);
      if (dateTo) range.lte = bdDayEndUtc(dateTo);
      parts.push({ createdAt: range });
    }
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }

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
          new Prisma.Decimal(item.unitCost).mul(
            new Prisma.Decimal(item.quantity),
          ),
        );
      }

      const discount = new Prisma.Decimal(dto.discount ?? 0);
      const tax = new Prisma.Decimal(dto.tax ?? 0);
      const shipping = new Prisma.Decimal(dto.shippingCost ?? 0);
      const grandTotal = totalAmount.sub(discount).add(tax).add(shipping);

      const paymentRows = (dto.payments ?? []).filter(
        (p) =>
          p.accountId != null &&
          new Prisma.Decimal(p.amount).greaterThan(0),
      );

      let cashPaid: Prisma.Decimal;
      let paymentAccountIdForPurchase: number | null | undefined;

      if (paymentRows.length > 0) {
        cashPaid = paymentRows.reduce(
          (acc, p) => acc.add(new Prisma.Decimal(p.amount)),
          new Prisma.Decimal(0),
        );
        paymentAccountIdForPurchase = paymentRows[0].accountId;
        const sentPaid = new Prisma.Decimal(dto.paidAmount);
        if (cashPaid.sub(sentPaid).abs().greaterThan(0.02)) {
          throw new BadRequestException(
            'paidAmount must match the sum of payment rows',
          );
        }
      } else {
        cashPaid = new Prisma.Decimal(dto.paidAmount);
        paymentAccountIdForPurchase = dto.paymentAccountId;
      }

      let advanceAppliedDec = new Prisma.Decimal(dto.advanceApplied ?? 0);
      if (advanceAppliedDec.lessThan(0)) {
        throw new BadRequestException('advanceApplied cannot be negative');
      }

      if (advanceAppliedDec.greaterThan(0)) {
        if (!dto.supplierId) {
          throw new BadRequestException(
            'supplierId is required when applying supplier advance',
          );
        }
        const supplier = await tx.supplier.findUnique({
          where: { id: dto.supplierId },
        });
        if (!supplier) {
          throw new NotFoundException('Supplier not found');
        }
        const advBal = new Prisma.Decimal(supplier.advanceBalance);
        const maxFromBill = grandTotal.sub(cashPaid);
        const maxApply = Prisma.Decimal.min(
          advBal,
          maxFromBill.greaterThan(0) ? maxFromBill : new Prisma.Decimal(0),
        );
        if (advanceAppliedDec.sub(maxApply).greaterThan(0.02)) {
          throw new BadRequestException(
            `advanceApplied cannot exceed ${maxApply.toFixed(2)} (supplier advance or remaining on this bill)`,
          );
        }
        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { advanceBalance: { decrement: advanceAppliedDec } },
        });
      } else {
        advanceAppliedDec = new Prisma.Decimal(0);
      }

      const totalPaidAmount = cashPaid.add(advanceAppliedDec);
      const dueAmount = grandTotal.sub(totalPaidAmount).greaterThan(0)
        ? grandTotal.sub(totalPaidAmount)
        : new Prisma.Decimal(0);

      const status = dueAmount.greaterThan(0) ? 'PARTIAL' : 'RECEIVED';

      let paymentMethodStored = dto.paymentMethod;
      if (!cashPaid.greaterThan(0) && advanceAppliedDec.greaterThan(0)) {
        paymentMethodStored = 'advance';
      }

      const purchase = await tx.purchase.create({
        data: {
          referenceNo,
          supplierId: dto.supplierId,
          branchId: dto.branchId,
          totalAmount,
          discount,
          tax,
          shippingCost: shipping,
          grandTotal,
          paidAmount: totalPaidAmount,
          dueAmount,
          advanceApplied: advanceAppliedDec,
          paymentMethod: paymentMethodStored,
          paymentAccountId: paymentAccountIdForPurchase ?? null,
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

        // Seller-style weighted average on store line: (prevQty × prevAvg + newQty × unitCost) / totalQty.
        // Here `sellingPrice` is the branch SKU average purchase cost (see admin inventory UI).
        const prevQty = storeProduct.quantity;
        const prevAvgCost = new Prisma.Decimal(storeProduct.sellingPrice);
        const addQty = item.quantity;
        const addUnitCost = new Prisma.Decimal(item.unitCost);
        const totalQtyAfter = prevQty + addQty;
        const weightedAvgCost =
          totalQtyAfter > 0
            ? prevAvgCost
                .mul(new Prisma.Decimal(prevQty))
                .add(addUnitCost.mul(new Prisma.Decimal(addQty)))
                .div(new Prisma.Decimal(totalQtyAfter))
            : addUnitCost;

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: {
            quantity: { increment: item.quantity },
            sellingPrice: weightedAvgCost.toDecimalPlaces(2),
          },
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

      if (paymentRows.length > 0) {
        for (const p of paymentRows) {
          const amt = new Prisma.Decimal(p.amount);
          const account = await tx.account.findUnique({
            where: { id: p.accountId },
          });
          if (!account) {
            throw new NotFoundException(`Account #${p.accountId} not found`);
          }
          if (new Prisma.Decimal(account.balance).lessThan(amt)) {
            throw new BadRequestException(
              `Insufficient balance on account "${account.name}"`,
            );
          }
          await tx.transaction.create({
            data: {
              accountId: p.accountId,
              type: 'DEBIT',
              amount: amt,
              reference: referenceNo,
              description: `Purchase payment - ${referenceNo}`,
            },
          });
          await tx.account.update({
            where: { id: p.accountId },
            data: { balance: { decrement: amt } },
          });
        }
      } else if (dto.paymentAccountId && cashPaid.greaterThan(0)) {
        const account = await tx.account.findUnique({
          where: { id: dto.paymentAccountId },
        });
        if (!account) {
          throw new NotFoundException(
            `Account #${dto.paymentAccountId} not found`,
          );
        }
        if (new Prisma.Decimal(account.balance).lessThan(cashPaid)) {
          throw new BadRequestException(
            `Insufficient balance on account "${account.name}"`,
          );
        }
        await tx.transaction.create({
          data: {
            accountId: dto.paymentAccountId,
            type: 'DEBIT',
            amount: cashPaid,
            reference: referenceNo,
            description: `Purchase payment - ${referenceNo}`,
          },
        });

        await tx.account.update({
          where: { id: dto.paymentAccountId },
          data: { balance: { decrement: cashPaid } },
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
    const { page = 1, limit = 16, sort, order = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where = this.purchaseWhereFromDto(query);

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

  async getSummary(query: PurchaseQueryDto) {
    const where = this.purchaseWhereFromDto(query);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const todayWhere = {
      AND: [where, { createdAt: { gte: startOfToday, lte: endOfToday } }],
    };

    const [total, pending, sumAgg, todayCount] = await Promise.all([
      this.prisma.purchase.count({ where }),
      this.prisma.purchase.count({
        where: { AND: [where, { status: 'PENDING' }] },
      }),
      this.prisma.purchase.aggregate({ where, _sum: { grandTotal: true } }),
      this.prisma.purchase.count({ where: todayWhere }),
    ]);

    return {
      total,
      pending,
      totalAmount: Number(sumAgg._sum.grandTotal ?? 0),
      todayPurchases: todayCount,
    };
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

  async findReturns(query: PurchaseQueryDto) {
    const { page = 1, limit = 16 } = query;
    const skip = (page - 1) * limit;
    const where = this.purchaseReturnWhereFromDto(query);

    const [data, total] = await Promise.all([
      this.prisma.purchaseReturn.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          purchase: {
            select: {
              id: true,
              referenceNo: true,
              supplier: true,
              branch: true,
            },
          },
          items: true,
        },
      }),
      this.prisma.purchaseReturn.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getReturnSummary(query: PurchaseQueryDto) {
    const where = this.purchaseReturnWhereFromDto(query);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const todayWhere = {
      AND: [where, { createdAt: { gte: startOfToday, lte: endOfToday } }],
    };

    const [total, todayReturns, sumAgg] = await Promise.all([
      this.prisma.purchaseReturn.count({ where }),
      this.prisma.purchaseReturn.count({ where: todayWhere }),
      this.prisma.purchaseReturn.aggregate({
        where,
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      total,
      todayReturns,
      totalAmount: Number(sumAgg._sum.totalAmount ?? 0),
    };
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
    const { page = 1, limit = 16, branchId, dateFrom, dateTo, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) {
      where.purchase = { branchId };
    }
    if (dateFrom || dateTo) {
      where.purchase = { ...where.purchase, createdAt: {} };
      if (dateFrom) where.purchase.createdAt.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.purchase.createdAt.lte = bdDayEndUtc(dateTo);
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
