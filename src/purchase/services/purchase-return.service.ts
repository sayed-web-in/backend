import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreatePurchaseReturnDto } from '../dto/create-purchase-return.dto.js';
import { PurchaseQueryDto } from '../dto/purchase-query.dto.js';
import { paginate } from '../../common/pagination.dto.js';
import {
  purchaseReturnWhereFromDto,
  composePurchaseReturnReason,
} from '../helpers/purchase-query.filters.js';
import { weightedAverageCostAfterStockOut } from '../../common/store-product-wac.js';

@Injectable()
export class PurchaseReturnService {
  constructor(private readonly prisma: PrismaService) {}
  private async getReturnedQtyByStoreProductForPurchase(
    purchaseId: number,
  ): Promise<Map<number, number>> {
    const rows = await this.prisma.purchaseReturnItem.findMany({
      where: { purchaseReturn: { purchaseId } },
      select: { storeProductId: true, quantity: true },
    });
    const m = new Map<number, number>();
    for (const r of rows) {
      m.set(r.storeProductId, (m.get(r.storeProductId) ?? 0) + r.quantity);
    }
    return m;
  }


  private allocateSerialsToPurchaseLines(
    items: { id: number; storeProductId: number; quantity: number }[],
    batches: Array<{
      storeProductId: number;
      serialNumbers: { serial: string; status: string }[];
    }>,
  ): Map<number, { serial: string; status: string }[]> {
    const batchRemaining = batches.map((b) => ({
      storeProductId: b.storeProductId,
      serials: (b.serialNumbers ?? []).map((s) => ({
        serial: s.serial,
        status: String(s.status),
      })),
    }));
    const serialsByItemId = new Map<number, { serial: string; status: string }[]>();
    const sortedItems = [...items].sort((a, b) => a.id - b.id);
    for (const item of sortedItems) {
      let need = item.quantity;
      const list: { serial: string; status: string }[] = [];
      for (const b of batchRemaining) {
        if (need <= 0) break;
        if (b.storeProductId !== item.storeProductId) continue;
        if (b.serials.length === 0) continue;
        const take = Math.min(need, b.serials.length);
        list.push(...b.serials.splice(0, take));
        need -= take;
      }
      serialsByItemId.set(item.id, list);
    }
    return serialsByItemId;
  }

  async createReturn(dto: CreatePurchaseReturnDto) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: dto.purchaseId },
      include: { items: true },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');

    const reasonStored = composePurchaseReturnReason(dto);

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
          reason: reasonStored ?? dto.reason ?? null,
          totalAmount: returnTotal,
          items: { create: returnItemsData },
        },
        include: { items: true },
      });

      for (const item of dto.items) {
        const sns = item.serialNumbers?.filter((s) => s?.trim()) ?? [];
        if (sns.length > 0) {
          if (sns.length !== item.quantity) {
            throw new BadRequestException(
              `Store product #${item.storeProductId}: select exactly ${item.quantity} serial(s) for IMEI-tracked return (got ${sns.length}).`,
            );
          }
          for (const serial of sns) {
            const row = await tx.serialNumber.findFirst({
              where: {
                serial,
                status: 'IN_STOCK',
                batch: { storeProductId: item.storeProductId },
              },
            });
            if (!row) {
              throw new BadRequestException(
                `Serial not in stock for this store SKU: ${serial}`,
              );
            }
            await tx.serialNumber.update({
              where: { id: row.id },
              data: { status: 'RETURNED' },
            });
          }
        }

        const sp = await tx.storeProduct.findUnique({
          where: { id: item.storeProductId },
          select: { quantity: true, averageCost: true },
        });
        if (!sp) {
          throw new NotFoundException(
            `Store product #${item.storeProductId} not found`,
          );
        }
        const prevQty = Number(sp.quantity);
        const prevAvg = new Prisma.Decimal(sp.averageCost);
        const removeQty = item.quantity;
        const removeTotalCost = new Prisma.Decimal(item.unitCost).mul(removeQty);
        const newAvg = weightedAverageCostAfterStockOut(
          prevQty,
          prevAvg,
          removeQty,
          removeTotalCost,
        );
        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: {
            quantity: { decrement: removeQty },
            averageCost: newAvg,
          },
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

      // Seller-admin settlement: reduce purchase due/grandTotal first, then cash/advance.
      const purchaseDue = new Prisma.Decimal(purchase.dueAmount ?? 0);
      const purchaseAdvance = new Prisma.Decimal(purchase.advanceApplied ?? 0);
      const purchasePaid = new Prisma.Decimal(purchase.paidAmount ?? 0);
      const purchaseGrand = new Prisma.Decimal(purchase.grandTotal ?? 0);
      const cashPaid = purchasePaid.sub(purchaseAdvance).greaterThan(0)
        ? purchasePaid.sub(purchaseAdvance)
        : new Prisma.Decimal(0);

      const dueReduction = Prisma.Decimal.min(returnTotal, purchaseDue);
      const refundRemaining = returnTotal.sub(dueReduction);
      const cashRefund = Prisma.Decimal.min(refundRemaining, cashPaid);
      const advanceRefund = refundRemaining.sub(cashRefund);

      const newGrandTotal = purchaseGrand.sub(returnTotal);
      let newDueAmount: Prisma.Decimal;
      let newPaidAmount: Prisma.Decimal;
      if (returnTotal.lte(purchaseDue)) {
        newDueAmount = purchaseDue.sub(returnTotal);
        newPaidAmount = purchasePaid;
      } else {
        newDueAmount = new Prisma.Decimal(0);
        newPaidAmount = purchasePaid.sub(returnTotal.sub(purchaseDue));
      }

      await tx.purchase.update({
        where: { id: dto.purchaseId },
        data: {
          status: allReturned ? 'RETURNED' : 'PARTIAL',
          grandTotal: newGrandTotal,
          dueAmount: newDueAmount,
          paidAmount: newPaidAmount,
        },
      });

      if (purchase.paymentAccountId && cashRefund.greaterThan(0)) {
        await tx.transaction.create({
          data: {
            accountId: purchase.paymentAccountId,
            type: 'CREDIT',
            amount: cashRefund,
            reference: purchase.referenceNo,
            description: `Purchase return #${purchaseReturn.id} — ${purchase.referenceNo}`,
          },
        });

        await tx.account.update({
          where: { id: purchase.paymentAccountId },
          data: { balance: { increment: cashRefund } },
        });
      }

      if (purchase.supplierId) {
        if (dueReduction.greaterThan(0)) {
          await tx.supplier.update({
            where: { id: purchase.supplierId },
            data: { totalDue: { decrement: dueReduction } },
          });
        }
        if (advanceRefund.greaterThan(0)) {
          await tx.supplier.update({
            where: { id: purchase.supplierId },
            data: { advanceBalance: { increment: advanceRefund } },
          });
        }
      }

      return purchaseReturn;
    });
  }

  async findReturns(query: PurchaseQueryDto) {
    const { page = 1, limit = 16 } = query;
    const skip = (page - 1) * limit;
    const where = purchaseReturnWhereFromDto(query);

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

  async findReturnOne(returnId: number) {
    const ret = await this.prisma.purchaseReturn.findUnique({
      where: { id: returnId },
      include: {
        purchase: {
          include: {
            supplier: true,
            branch: true,
            paymentAccount: true,
          },
        },
        items: true,
      },
    });
    if (!ret) throw new NotFoundException('Purchase return not found');

    const spIds = [...new Set(ret.items.map((i) => i.storeProductId))];
    const storeProducts =
      spIds.length > 0
        ? await this.prisma.storeProduct.findMany({
            where: { id: { in: spIds } },
            include: {
              product: true,
              productVariant: {
                include: {
                  attributes: { include: { attributeValue: true } },
                },
              },
            },
          })
        : [];
    const spById = new Map(storeProducts.map((sp) => [sp.id, sp]));

    const items = ret.items.map((it) => ({
      ...it,
      storeProduct: spById.get(it.storeProductId) ?? null,
    }));

    const ref = ret.purchase.referenceNo;
    const returnTotalNum = Number(ret.totalAmount);
    const windowStart = new Date(ret.createdAt.getTime() - 120_000);
    const windowEnd = new Date(ret.createdAt.getTime() + 120_000);

    const ledgerCandidates = await this.prisma.transaction.findMany({
      where: {
        reference: ref,
        type: 'CREDIT',
        description: { contains: 'Purchase return' },
      },
      include: {
        account: { select: { id: true, name: true, accountNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    const ledgerCredits = ledgerCandidates.filter(
      (t) =>
        (t.description?.includes(`Purchase return #${ret.id}`) ?? false) ||
        (t.createdAt >= windowStart &&
          t.createdAt <= windowEnd &&
          Number(t.amount) === returnTotalNum),
    );

    const accounting = {
      returnAmount: returnTotalNum,
      purchaseReference: ref,
      supplierDueReduced: ret.purchase.supplierId != null,
      supplierName: ret.purchase.supplier?.name ?? null,
      stockReduced: true,
      batchAdjusted: true,
      accountCredited:
        ret.purchase.paymentAccountId != null &&
        Number(returnTotalNum) > 0,
      paymentAccountName: ret.purchase.paymentAccount?.name ?? null,
      paymentAccountId: ret.purchase.paymentAccountId,
      steps: [
        'Branch store quantity was decreased for each returned store SKU.',
        'The latest matching batch had available quantity reduced and return quantity increased.',
        'Purchase status was updated to PARTIAL or RETURNED when every line was fully returned.',
      ] as string[],
    };
    if (accounting.accountCredited && accounting.paymentAccountName) {
      accounting.steps.push(
        `A CREDIT was posted to account “${accounting.paymentAccountName}” for the return value (cash back into that account).`,
      );
    } else if (!accounting.accountCredited) {
      accounting.steps.push(
        'No automatic account credit was posted because this purchase had no payment account on file.',
      );
    }
    if (accounting.supplierDueReduced && accounting.supplierName) {
      accounting.steps.push(
        `Supplier “${accounting.supplierName}” total due was reduced by the return amount (less owed to supplier).`,
      );
    }

    return {
      ...ret,
      items,
      accounting,
      ledgerCredits,
    };
  }

  async getReturnSummary(query: PurchaseQueryDto) {
    const where = purchaseReturnWhereFromDto(query);
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
}
