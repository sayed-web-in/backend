import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { paginate } from '../../common/pagination.dto.js';
import { returnCogsForLines } from '../../common/sale-return-seller.js';
import { weightedAverageCostAfterStockIn } from '../../common/store-product-wac.js';
import {
  resolveReturnGainIncomeCategoryId,
  resolveSaleReturnRefundExpenseCategoryId,
} from '../../common/finance-default-categories.js';
import { CreateSaleReturnDto } from '../dto/create-sale-return.dto.js';
import { UpdateSaleReturnDto } from '../dto/update-sale-return.dto.js';
import type { SaleReturnQueryDto } from '../dto/sale-return-query.dto.js';
import { saleReturnWhereFromDto } from '../helpers/sale-query.filters.js';
import {
  composeSaleReturnReason,
  lineDamageAmount,
  parseReturnDate,
  priorReturnedForSaleLine,
  resolveSaleItemForReturn,
} from '../helpers/sale-return.utils.js';

@Injectable()
export class SaleReturnService {
  constructor(private readonly prisma: PrismaService) {}

  async findReturns(query: SaleReturnQueryDto) {
    const { page = 1, limit = 16 } = query;
    const skip = (page - 1) * limit;
    const where = saleReturnWhereFromDto(query);

    const [data, total] = await Promise.all([
      this.prisma.saleReturn.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sale: {
            select: {
              id: true,
              invoiceNumber: true,
              customer: true,
              branch: true,
            },
          },
          items: true,
        },
      }),
      this.prisma.saleReturn.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getSaleReturnSummary(query: SaleReturnQueryDto) {
    const where = saleReturnWhereFromDto(query);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const todayWhere = {
      AND: [where, { createdAt: { gte: startOfToday, lte: endOfToday } }],
    };

    const [total, sumAgg, sumRefund, sumGain, todayCount] = await Promise.all([
      this.prisma.saleReturn.count({ where }),
      this.prisma.saleReturn.aggregate({
        where,
        _sum: { totalAmount: true },
      }),
      this.prisma.saleReturn.aggregate({
        where,
        _sum: { refundAmount: true },
      }),
      this.prisma.saleReturn.aggregate({
        where,
        _sum: { returnGain: true },
      }),
      this.prisma.saleReturn.count({ where: todayWhere }),
    ]);

    return {
      total,
      totalReturnAmount: Number(sumAgg._sum.totalAmount ?? 0),
      totalRefundAmount: Number(sumRefund._sum.refundAmount ?? 0),
      totalReturnGain: Number(sumGain._sum.returnGain ?? 0),
      todayReturns: todayCount,
    };
  }

  private async generateReturnNo(): Promise<string> {
    const count = await this.prisma.saleReturn.count();
    const seq = (count + 1).toString().padStart(5, '0');
    return `SR-${Date.now().toString().slice(-8)}-${seq}`;
  }

  private parseReturnDate(raw?: string): Date {
    if (!raw?.trim()) return new Date();
    const d = new Date(raw.trim());
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  private async restoreReturnStock(
    tx: Prisma.TransactionClient,
    prepared: Array<{
      dto: CreateSaleReturnDto['items'][0];
      saleItem: { id: number; costPrice: Prisma.Decimal | null };
    }>,
  ): Promise<void> {
    for (const p of prepared) {
      const item = p.dto;
      const saleItem = p.saleItem;
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
      const unitCost =
        saleItem.costPrice != null && Number(saleItem.costPrice) > 0
          ? new Prisma.Decimal(saleItem.costPrice)
          : prevAvg;
      const addQty = item.quantity;
      const addTotalCost = unitCost.mul(addQty);
      const newAvg = weightedAverageCostAfterStockIn(
        prevQty,
        prevAvg,
        addQty,
        addTotalCost,
      );
      await tx.storeProduct.update({
        where: { id: item.storeProductId },
        data: {
          quantity: { increment: addQty },
          averageCost: newAvg,
        },
      });
      const batch = await tx.batch.findFirst({
        where: { storeProductId: item.storeProductId },
        orderBy: { createdAt: 'desc' },
      });
      if (batch) {
        const restoreQty = Math.min(batch.soldQty, item.quantity);
        if (restoreQty > 0) {
          await tx.batch.update({
            where: { id: batch.id },
            data: {
              availableQty: { increment: restoreQty },
              soldQty: { decrement: restoreQty },
              returnQty: { increment: restoreQty },
            },
          });
        }
      }
      const sns = item.serialNumbers?.map((s) => s?.trim()).filter(Boolean) ?? [];
      for (const serial of sns) {
        await tx.serialNumber.updateMany({
          where: { serial, saleItemId: saleItem.id, status: 'SOLD' },
          data: { status: 'RETURNED', saleItemId: null },
        });
      }
    }
  }


  private async postSaleReturnRefundExpense(
    tx: Prisma.TransactionClient,
    opts: {
      branchId: number;
      accountId: number;
      amount: Prisma.Decimal;
      returnNo: string;
      returnId: number;
    },
  ): Promise<void> {
    const acc = await tx.account.findUnique({ where: { id: opts.accountId } });
    if (!acc) throw new NotFoundException('Account not found');
    if (!acc.isActive) throw new BadRequestException('Account is not active');
    const bal = new Prisma.Decimal(acc.balance);
    if (opts.amount.sub(bal).greaterThan(0.01)) {
      throw new BadRequestException('Insufficient account balance');
    }
    const categoryId = await resolveSaleReturnRefundExpenseCategoryId(tx);
    const label = `Sale Return Refund - ${opts.returnNo}`;
    const expense = await tx.expense.create({
      data: {
        branchId: opts.branchId,
        categoryId,
        accountId: opts.accountId,
        name: label,
        reference: opts.returnNo,
        status: 'active',
        amount: opts.amount,
        note: `Refund for sale return #${opts.returnId}`,
        date: new Date(),
      },
    });
    await tx.transaction.create({
      data: {
        accountId: opts.accountId,
        type: 'DEBIT',
        amount: opts.amount,
        reference: opts.returnNo,
        description: label,
      },
    });
    await tx.account.update({
      where: { id: opts.accountId },
      data: { balance: { decrement: opts.amount } },
    });
    void expense;
  }

  async createReturn(dto: CreateSaleReturnDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: dto.saleId },
      include: {
        items: { include: { serialNumbers: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.status === 'RETURNED') {
      throw new BadRequestException('Sale is already fully returned');
    }

    const priorRows = await this.prisma.saleReturnItem.findMany({
      where: { saleReturn: { saleId: dto.saleId } },
      select: { saleItemId: true, storeProductId: true, quantity: true },
    });

    const reasonStored = composeSaleReturnReason(dto);

    return this.prisma.$transaction(async (tx) => {
      const saleItems = sale.items.map((i) => ({
        id: i.id,
        storeProductId: i.storeProductId,
        quantity: i.quantity,
      }));

      type SaleItemRow = (typeof sale.items)[number];

      type Prepared = {
        dto: (typeof dto.items)[0];
        saleItem: SaleItemRow;
        lineTotal: Prisma.Decimal;
        damage: Prisma.Decimal;
        refundLine: Prisma.Decimal;
        gainLine: Prisma.Decimal;
        dmgType: string | null;
        dmgVal: Prisma.Decimal | null;
      };

      const prepared: Prepared[] = [];

      for (const item of dto.items) {
        const saleItem = resolveSaleItemForReturn(
          sale,
          item,
        ) as (typeof sale.items)[number];
        const already = priorReturnedForSaleLine(
          saleItems,
          priorRows,
          saleItem,
        );
        const maxLeft = saleItem.quantity - already;
        if (item.quantity > maxLeft) {
          throw new BadRequestException(
            `Return qty ${item.quantity} exceeds remaining ${maxLeft} for invoice line #${saleItem.id}`,
          );
        }

        const lineTotal = new Prisma.Decimal(item.unitPrice).mul(
          new Prisma.Decimal(item.quantity),
        );
        const dmgType = item.damageDeductionType ?? 'none';
        const damage = lineDamageAmount(
          lineTotal,
          dmgType,
          item.damageDeductionValue,
        );
        if (damage.sub(lineTotal).greaterThan(0.02)) {
          throw new BadRequestException('Damage deduction cannot exceed line total');
        }
        const refundLine = lineTotal.sub(damage);
        const gainLine = damage;

        const soldSerials = await tx.serialNumber.findMany({
          where: { saleItemId: saleItem.id, status: 'SOLD' },
          select: { id: true, serial: true },
        });
        if (soldSerials.length > 0) {
          const sns = item.serialNumbers?.map((s) => s?.trim()).filter(Boolean) ?? [];
          if (sns.length !== item.quantity) {
            throw new BadRequestException(
              `Line #${saleItem.id}: select exactly ${item.quantity} serial(s) for IMEI-tracked return (got ${sns.length}).`,
            );
          }
          const allowed = new Set(soldSerials.map((s) => s.serial));
          for (const sn of sns) {
            if (!allowed.has(sn)) {
              throw new BadRequestException(`Serial not sold on this line: ${sn}`);
            }
          }
        } else if (item.serialNumbers?.length) {
          throw new BadRequestException(
            `Line #${saleItem.id}: serialNumbers were sent but this line has no sold IMEI rows`,
          );
        }

        prepared.push({
          dto: item,
          saleItem,
          lineTotal,
          damage,
          refundLine,
          gainLine,
          dmgType: dmgType === 'none' ? null : dmgType,
          dmgVal:
            dmgType !== 'none' && (item.damageDeductionValue ?? 0) > 0
              ? new Prisma.Decimal(item.damageDeductionValue ?? 0)
              : null,
        });
      }

      let returnGross = new Prisma.Decimal(0);
      let refundTotal = new Prisma.Decimal(0);
      let gainTotal = new Prisma.Decimal(0);
      for (const p of prepared) {
        returnGross = returnGross.add(p.lineTotal);
        refundTotal = refundTotal.add(p.refundLine);
        gainTotal = gainTotal.add(p.gainLine);
      }

      const returnItemsCreate = prepared.map((p) => ({
        saleItemId: p.saleItem.id,
        storeProductId: p.dto.storeProductId,
        quantity: p.dto.quantity,
        unitPrice: p.dto.unitPrice,
        total: p.lineTotal,
        damageDeductionType: p.dmgType,
        damageDeductionValue: p.dmgVal,
      }));

      const refundBase = refundTotal;
      const refundType = dto.refundType ?? 'full';
      let refundCap = refundBase;
      if (refundType === 'partial' && dto.refundAmount != null) {
        refundCap = Prisma.Decimal.min(
          new Prisma.Decimal(dto.refundAmount),
          refundBase,
        );
      }
      if (refundCap.sub(refundBase).greaterThan(0.02)) {
        throw new BadRequestException(
          'Refund amount cannot exceed (total − damage deduction)',
        );
      }

      const returnNo = await this.generateReturnNo();
      const saleReturn = await tx.saleReturn.create({
        data: {
          saleId: dto.saleId,
          returnNo,
          returnDate: parseReturnDate(dto.returnDate),
          reason: reasonStored ?? dto.reason ?? null,
          totalAmount: returnGross,
          totalDamageAmount: gainTotal,
          refundAmount: refundCap,
          refundType,
          returnGain: new Prisma.Decimal(0),
          status: 'pending',
          pendingCashRefund: new Prisma.Decimal(0),
          cashRefundPaid: new Prisma.Decimal(0),
          items: { create: returnItemsCreate },
        },
        include: { items: true },
      });

      return saleReturn;
    });
  }

  async updateSaleReturn(returnId: number, dto: UpdateSaleReturnDto) {
    if (dto.status === 'cancelled') {
      throw new BadRequestException('Cancel return is not supported yet');
    }
    if (
      dto.status !== 'completed' &&
      (dto.paymentAmount != null || dto.refundAmount != null)
    ) {
      const row = await this.prisma.saleReturn.findUnique({
        where: { id: returnId },
        select: { status: true },
      });
      if (row?.status === 'pending') {
        throw new BadRequestException(
          'Set status to completed to restore stock and post refunds (seller-admin).',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const ret = await tx.saleReturn.findUnique({
        where: { id: returnId },
        include: {
          items: { include: { saleItem: { select: { costPrice: true } } } },
          sale: { include: { items: true } },
        },
      });
      if (!ret) throw new NotFoundException('Sale return not found');
      if (ret.status === 'cancelled') {
        throw new BadRequestException('This return is cancelled');
      }

      const returnNo = ret.returnNo ?? `SR-${ret.id}`;
      const refundCapDec = new Prisma.Decimal(ret.refundAmount ?? 0);
      const refundCap = Number(refundCapDec);
      const statusChangingToCompleted =
        ret.status === 'pending' && dto.status === 'completed';

      let pendingCash = new Prisma.Decimal(ret.pendingCashRefund ?? 0);
      let cashPaid = new Prisma.Decimal(ret.cashRefundPaid ?? 0);

      if (statusChangingToCompleted) {
        const preparedForStock = ret.items.map((it) => {
          const saleItem = ret.sale.items.find((si) => si.id === it.saleItemId);
          if (!saleItem) {
            throw new BadRequestException(
              `Sale line #${it.saleItemId} not found for return`,
            );
          }
          return {
            dto: {
              storeProductId: it.storeProductId,
              quantity: it.quantity,
              unitPrice: Number(it.unitPrice),
              serialNumbers: [] as string[],
            },
            saleItem,
          };
        });
        await this.restoreReturnStock(tx, preparedForStock);

        const priorRows = await tx.saleReturnItem.findMany({
          where: {
            saleReturn: { saleId: ret.saleId },
            NOT: { saleReturnId: returnId },
          },
          select: { saleItemId: true, storeProductId: true, quantity: true },
        });
        const saleItems = ret.sale.items.map((i) => ({
          id: i.id,
          storeProductId: i.storeProductId,
          quantity: i.quantity,
        }));
        const newReturnRows = ret.items.map((it) => ({
          saleItemId: it.saleItemId,
          storeProductId: it.storeProductId,
          quantity: it.quantity,
        }));
        const allSold = ret.sale.items.every((si) => {
          const returned = priorReturnedForSaleLine(
            saleItems,
            [...priorRows, ...newReturnRows],
            si,
          );
          return returned >= si.quantity;
        });
        await tx.sale.update({
          where: { id: ret.saleId },
          data: { status: allSold ? 'RETURNED' : 'PARTIAL_RETURN' },
        });

        const saleRow = await tx.sale.findUnique({ where: { id: ret.saleId } });
        if (!saleRow) throw new NotFoundException('Sale not found');
        const due = new Prisma.Decimal(saleRow.dueAmount ?? 0);
        const adv = new Prisma.Decimal(saleRow.advanceApplied ?? 0);
        const grand = new Prisma.Decimal(saleRow.grandTotal ?? 0);
        const refund = refundCapDec;

        let dueReduction = new Prisma.Decimal(0);
        let advanceRefund = new Prisma.Decimal(0);
        if (refund.greaterThan(0)) {
          dueReduction = Prisma.Decimal.min(refund, due);
          const afterDue = refund.sub(dueReduction);
          if (grand.greaterThan(0) && adv.greaterThan(0)) {
            const prop = adv.mul(refund).div(grand);
            advanceRefund = Prisma.Decimal.min(afterDue, prop);
          }
          if (advanceRefund.sub(adv).greaterThan(0.02)) {
            advanceRefund = adv;
          }
          const cashOwed = afterDue.sub(advanceRefund);
          pendingCash = cashOwed.greaterThan(0) ? cashOwed : new Prisma.Decimal(0);

          const saleMoneyPatch: Prisma.SaleUpdateInput = {};
          if (dueReduction.greaterThan(0)) {
            saleMoneyPatch.dueAmount = { decrement: dueReduction };
          }
          if (advanceRefund.greaterThan(0)) {
            saleMoneyPatch.advanceApplied = { decrement: advanceRefund };
          }
          if (Object.keys(saleMoneyPatch).length > 0) {
            await tx.sale.update({
              where: { id: ret.saleId },
              data: saleMoneyPatch,
            });
          }
          if (advanceRefund.greaterThan(0) && saleRow.customerId) {
            await tx.customer.update({
              where: { id: saleRow.customerId },
              data: { totalAdvance: { increment: advanceRefund } },
            });
          }
        }

        const returnCogs = await returnCogsForLines(
          this.prisma,
          ret.items.map((it) => ({
            quantity: it.quantity,
            storeProductId: it.storeProductId,
            saleItemId: it.saleItemId,
            saleItem: it.saleItem,
          })),
        );
        const returnGainAmt = Math.max(
          0,
          Math.round((returnCogs - refundCap) * 100) / 100,
        );
        if (returnGainAmt > 0.005) {
          const incomeCatId = await resolveReturnGainIncomeCategoryId(tx);
          let gainAccountId = dto.refundAccountId;
          if (!gainAccountId) {
            const fallback = await tx.account.findFirst({
              where: { isActive: true },
              orderBy: { id: 'asc' },
              select: { id: true },
            });
            gainAccountId = fallback?.id;
          }
          if (gainAccountId) {
            /** Seller-admin: P&amp;L / other income only — do not credit cash (TB uses refund expense debit). */
            await tx.income.create({
              data: {
                branchId: ret.sale.branchId,
                categoryId: incomeCatId,
                accountId: gainAccountId,
                name: `Sale Return Gain - ${returnNo}`,
                amount: new Prisma.Decimal(returnGainAmt),
                reference: returnNo,
                status: 'active',
                note: `Return gain: inventory ${returnCogs} − refund ${refundCap}`,
                date: new Date(),
              },
            });
          }
        }
        await tx.saleReturn.update({
          where: { id: returnId },
          data: { returnGain: new Prisma.Decimal(returnGainAmt) },
        });
      }

      const cashOwed = Number(pendingCash);
      const paidSoFar = Number(cashPaid);
      const remainingCash = Math.max(0, cashOwed - paidSoFar);
      let refundPaidNow = 0;
      if (dto.paymentAmount != null && dto.paymentAmount > 0) {
        refundPaidNow = Math.min(dto.paymentAmount, remainingCash);
      } else if (dto.refundAmount != null) {
        refundPaidNow = Math.max(
          0,
          Math.min(dto.refundAmount, cashOwed) - paidSoFar,
        );
      }
      refundPaidNow = Math.round(refundPaidNow * 100) / 100;

      if (refundPaidNow > 0.005) {
        if (!dto.refundAccountId) {
          throw new BadRequestException(
            'refundAccountId is required to post a cash refund',
          );
        }
        await this.postSaleReturnRefundExpense(tx, {
          branchId: ret.sale.branchId,
          accountId: dto.refundAccountId,
          amount: new Prisma.Decimal(refundPaidNow),
          returnNo,
          returnId,
        });
        cashPaid = cashPaid.add(new Prisma.Decimal(refundPaidNow));
      }

      const newStatus =
        statusChangingToCompleted || ret.status === 'completed'
          ? 'completed'
          : ret.status;

      await tx.saleReturn.update({
        where: { id: returnId },
        data: {
          status: newStatus,
          pendingCashRefund: pendingCash,
          cashRefundPaid: cashPaid,
          refundAccountId: dto.refundAccountId ?? ret.refundAccountId,
        },
      });
    });

    return this.findReturnOne(returnId);
  }

  async findReturnOne(returnId: number) {
    const ret = await this.prisma.saleReturn.findUnique({
      where: { id: returnId },
      include: {
        sale: {
          include: {
            customer: true,
            branch: true,
            paymentAccount: true,
          },
        },
        refundAccount: true,
        items: true,
      },
    });
    if (!ret) throw new NotFoundException('Sale return not found');

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

    const gross = Number(ret.totalAmount);
    const damage = Number(ret.totalDamageAmount ?? 0);
    const refund = Number(ret.refundAmount);
    let gain = Number(ret.returnGain);
    const pendingCap = Number(ret.pendingCashRefund ?? 0);
    const cashPaid = Number(ret.cashRefundPaid ?? 0);
    const remainingCash = Math.max(0, Math.round((pendingCap - cashPaid) * 100) / 100);
    const status = ret.status ?? 'pending';
    const completed = status === 'completed';

    const itemsWithCost = await this.prisma.saleReturnItem.findMany({
      where: { saleReturnId: returnId },
      select: {
        quantity: true,
        storeProductId: true,
        saleItemId: true,
        saleItem: { select: { costPrice: true } },
      },
    });
    const returnCogs = await returnCogsForLines(this.prisma, itemsWithCost);
    const computedGain = Math.max(
      0,
      Math.round((returnCogs - refund) * 100) / 100,
    );
    if (!completed || gain <= 0) {
      gain = computedGain;
    }

    const accounting = {
      grossReturnValue: gross,
      damageDeduction: damage,
      refundToCustomer: refund,
      returnGainRetained: gain,
      status,
      pendingCashRefund: pendingCap,
      cashRefundPaid: cashPaid,
      remainingCashRefund: remainingCash,
      stockRestored: completed,
      customerAdvanceCredited: completed && refund > 0 && ret.sale.customerId != null,
      accountDebited: cashPaid > 0.005,
      paymentAccountName: ret.sale.paymentAccount?.name ?? null,
      refundAccountName: ret.refundAccount?.name ?? null,
      steps: [] as string[],
    };
    if (!completed) {
      accounting.steps.push(
        'Return is pending (seller-admin): stock and customer due/advance adjustments run when you complete the return.',
        `Net refund cap: ${refund.toFixed(2)} (gross ${gross.toFixed(2)} − damage ${damage.toFixed(2)}).`,
      );
    } else {
      accounting.steps.push(
        'Store quantity was increased for each returned SKU.',
        'Latest batch sold quantity was reduced where possible.',
        'Sale status set to RETURNED or PARTIAL_RETURN when every invoice line is fully returned.',
        'Sale due was reduced first, then customer advance wallet was credited where applicable.',
      );
      if (gain > 0) {
        accounting.steps.push(
          `Return gain (COGS − refund): ${gain.toFixed(2)} — posted as Income and in P&L return gain.`,
        );
      }
      if (pendingCap > 0.005) {
        accounting.steps.push(
          `Cash refund owed: ${pendingCap.toFixed(2)}. Paid: ${cashPaid.toFixed(2)}; remaining: ${remainingCash.toFixed(2)} (Sale Return Refund expense).`,
        );
      } else if (refund > 0) {
        accounting.steps.push(
          'No cash payout required — refund fully absorbed by due and advance.',
        );
      }
    }

    return {
      ...ret,
      items,
      accounting,
    };
  }

  /** @deprecated Use updateSaleReturn — kept for older admin clients. */
  async recordReturnCashRefund(
    returnId: number,
    dto: { paymentAmount: number; refundAccountId: number },
  ) {
    const ret = await this.prisma.saleReturn.findUnique({
      where: { id: returnId },
      select: { status: true },
    });
    return this.updateSaleReturn(returnId, {
      status: ret?.status === 'pending' ? 'completed' : undefined,
      paymentAmount: dto.paymentAmount,
      refundAccountId: dto.refundAccountId,
    });
  }
}
