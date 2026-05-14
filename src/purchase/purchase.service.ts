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
import { weightedAverageCostAfterPurchase } from '../common/store-product-wac.js';

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

        const prevQty = storeProduct.quantity;
        const prevAvg = new Prisma.Decimal(storeProduct.averageCost);
        const addQty = item.quantity;
        const addUnit = new Prisma.Decimal(item.unitCost);
        const newAvg = weightedAverageCostAfterPurchase(
          prevQty,
          prevAvg,
          addQty,
          addUnit,
        );

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: {
            quantity: { increment: item.quantity },
            averageCost: newAvg.toDecimalPlaces(6),
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

  private composePurchaseReturnReason(dto: CreatePurchaseReturnDto): string | null {
    const blocks: string[] = [];
    if (dto.returnDate?.trim()) blocks.push(`Return date: ${dto.returnDate.trim()}`);
    if (dto.reference?.trim()) blocks.push(`Reference: ${dto.reference.trim()}`);
    if (dto.responsiblePerson?.trim()) {
      blocks.push(`Responsible: ${dto.responsiblePerson.trim()}`);
    }
    if (dto.notes?.trim()) blocks.push(`Notes: ${dto.notes.trim()}`);
    dto.items.forEach((it, idx) => {
      if (it.returnType) {
        blocks.push(
          `Line ${idx + 1} (store product #${it.storeProductId}): ${it.returnType}`,
        );
      }
    });
    if (dto.reason?.trim()) blocks.push(dto.reason.trim());
    const s = blocks.join('\n').trim();
    return s.length ? s : null;
  }

  /**
   * Map IMEI/serial rows from purchase-time batches (same transaction window) onto line items.
   */
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

    const reasonStored = this.composePurchaseReturnReason(dto);

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

      // Refund allocation: first reduce due, then refund cash (payment account),
      // and finally refund supplier advance (advanceBalance).
      const purchaseDue = new Prisma.Decimal(purchase.dueAmount ?? 0);
      const purchaseAdvance = new Prisma.Decimal(purchase.advanceApplied ?? 0);
      const purchasePaid = new Prisma.Decimal(purchase.paidAmount ?? 0);
      const cashPaid = purchasePaid.sub(purchaseAdvance).greaterThan(0)
        ? purchasePaid.sub(purchaseAdvance)
        : new Prisma.Decimal(0);

      const dueReduction = Prisma.Decimal.min(returnTotal, purchaseDue);
      const refundRemaining = returnTotal.sub(dueReduction);
      const cashRefund = Prisma.Decimal.min(refundRemaining, cashPaid);
      const advanceRefund = refundRemaining.sub(cashRefund);

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
