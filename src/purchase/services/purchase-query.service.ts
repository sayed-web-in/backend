import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PurchaseQueryDto } from '../dto/purchase-query.dto.js';
import { paginate } from '../../common/pagination.dto.js';
import { Prisma } from '@prisma/client';
import { purchaseWhereFromDto } from '../helpers/purchase-query.filters.js';
import { bdDayEndUtc, bdDayStartUtc } from '../../common/bd-time.js';

@Injectable()
export class PurchaseQueryService {
  constructor(private readonly prisma: PrismaService) {}
  async findAll(query: PurchaseQueryDto) {
    const { page = 1, limit = 16, sort, order = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where = purchaseWhereFromDto(query);

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
    const where = purchaseWhereFromDto(query);
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

    const [supplierTxns, accountTxns, batches] = await Promise.all([
      this.prisma.supplierTransaction.findMany({
        where: { purchaseId: id },
        include: {
          account: {
            select: { id: true, name: true, accountNumber: true },
          },
        },
        orderBy: { transactionDate: 'desc' },
      }),
      this.prisma.transaction.findMany({
        where: { reference: purchase.referenceNo },
        include: {
          account: {
            select: { id: true, name: true, accountNumber: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      (async () => {
        const spIds = [...new Set(purchase.items.map((i) => i.storeProductId))];
        if (spIds.length === 0) return [];
        const windowMs = 120_000;
        const t0 = new Date(purchase.createdAt.getTime() - windowMs);
        const t1 = new Date(purchase.createdAt.getTime() + windowMs);
        const whereBatch: any = {
          storeProductId: { in: spIds },
          batchType: 'purchase',
          createdAt: { gte: t0, lte: t1 },
        };
        if (purchase.supplierId != null) {
          whereBatch.supplierId = purchase.supplierId;
        }
        return this.prisma.batch.findMany({
          where: whereBatch,
          include: { serialNumbers: true },
          orderBy: { id: 'asc' },
        });
      })(),
    ]);

    const serialsByItemId = this.allocateSerialsToPurchaseLines(
      purchase.items,
      batches,
    );

    const paymentHistory = [
      ...accountTxns.map((t) => ({
        id: `acct-${t.id}`,
        source: 'account' as const,
        paymentDate: t.createdAt.toISOString(),
        amount: Number(t.amount),
        paymentMethod: null as string | null,
        transactionId: t.reference,
        note: t.description,
        account: t.account
          ? {
              accountName: t.account.name,
              accountNumber: t.account.accountNumber,
            }
          : null,
      })),
      ...supplierTxns.map((st) => ({
        id: `sup-${st.id}`,
        source: 'supplier' as const,
        paymentDate: st.transactionDate.toISOString(),
        amount: Number(st.amount),
        paymentMethod: String(st.type),
        transactionId: st.invoiceNo ?? `ST-${st.id}`,
        note: st.note,
        account: st.account
          ? {
              accountName: st.account.name,
              accountNumber: st.account.accountNumber,
            }
          : null,
      })),
    ].sort(
      (a, b) =>
        new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime(),
    );

    const returnedMap = await this.getReturnedQtyByStoreProductForPurchase(id);
    const sortedLines = [...purchase.items].sort((a, b) => a.id - b.id);
    const remLeft = new Map<number, number>();
    for (const spId of new Set(purchase.items.map((i) => i.storeProductId))) {
      remLeft.set(spId, returnedMap.get(spId) ?? 0);
    }
    const availByItemId = new Map<number, number>();
    for (const it of sortedLines) {
      const rem = remLeft.get(it.storeProductId) ?? 0;
      const used = Math.min(it.quantity, rem);
      availByItemId.set(it.id, Math.max(0, it.quantity - used));
      remLeft.set(it.storeProductId, rem - used);
    }

    const items = purchase.items.map((it) => {
      const serialObjs = serialsByItemId.get(it.id) ?? [];
      const availableSerials = serialObjs
        .filter((s) => s.status === 'IN_STOCK')
        .map((s) => s.serial);
      return {
        ...it,
        serialNumbers: serialObjs,
        availableSerials,
        availableReturnQty: availByItemId.get(it.id) ?? it.quantity,
      };
    });

    return { ...purchase, items, paymentHistory };
  }

  /** Sum return quantities already posted against this purchase, per store product. */
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
    const serialsByItemId = new Map<
      number,
      { serial: string; status: string }[]
    >();
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
