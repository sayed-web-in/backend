import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { bdDayEndUtc, bdDayStartUtc } from '../common/bd-time.js';
import { CreateSaleDto } from './dto/create-sale.dto.js';
import { CompletePaylaterDto } from './dto/complete-paylater.dto.js';
import { AddSalePaymentDto } from './dto/add-sale-payment.dto.js';
import { CreateSaleReturnDto } from './dto/create-sale-return.dto.js';
import { PatchSaleReturnRefundDto } from './dto/patch-sale-return-refund.dto.js';
import { SaleQueryDto } from './dto/sale-query.dto.js';
import { ProductTransactionQueryDto } from './dto/product-transaction-query.dto.js';
import type { PayLaterQueryDto } from './dto/pay-later-query.dto.js';
import type { SaleReturnQueryDto } from './dto/sale-return-query.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class SaleService {
  constructor(private prisma: PrismaService) {}

  private generateInvoiceNumber(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV-${ts}-${rand}`;
  }

  async createSale(dto: CreateSaleDto) {
    return this.prisma.$transaction(async (tx) => {
      const invoiceNumber = this.generateInvoiceNumber();

      let totalAmount = new Prisma.Decimal(0);
      for (const item of dto.items) {
        const itemTotal = item.unitPrice * item.quantity - (item.discount ?? 0);
        totalAmount = totalAmount.add(new Prisma.Decimal(itemTotal));
      }

      const discount = new Prisma.Decimal(dto.discount ?? 0);
      const tax = new Prisma.Decimal(dto.tax ?? 0);
      const servicesTotal = new Prisma.Decimal(dto.servicesTotal ?? 0);
      if (servicesTotal.lessThan(0)) {
        throw new BadRequestException('servicesTotal cannot be negative');
      }
      const grandTotal = totalAmount.sub(discount).add(tax).add(servicesTotal);

      const status = dto.status ?? 'COMPLETED';
      let advanceDec = new Prisma.Decimal(dto.advanceApplied ?? 0);
      if (advanceDec.lessThan(0)) advanceDec = new Prisma.Decimal(0);

      if (advanceDec.greaterThan(0) && !dto.customerId) {
        throw new BadRequestException(
          'customerId is required when applying customer advance',
        );
      }

      const totalCashGross =
        status === 'PAY_LATER'
          ? new Prisma.Decimal(0)
          : new Prisma.Decimal(dto.paidAmount ?? 0);

      if (advanceDec.greaterThan(0)) {
        const cust = await tx.customer.findUnique({
          where: { id: dto.customerId! },
          select: { totalAdvance: true },
        });
        if (!cust) throw new NotFoundException('Customer not found');
        const advBal = new Prisma.Decimal(cust.totalAdvance);
        if (advanceDec.sub(advBal).greaterThan(0.02)) {
          throw new BadRequestException(
            `advanceApplied cannot exceed customer advance balance (${advBal.toFixed(2)})`,
          );
        }
        if (advanceDec.sub(grandTotal).greaterThan(0.02)) {
          throw new BadRequestException(
            'advanceApplied cannot exceed sale grand total',
          );
        }
      }

      const totalPaid = advanceDec.add(totalCashGross);
      const changeAmount = totalPaid.sub(grandTotal).greaterThan(0)
        ? totalPaid.sub(grandTotal)
        : new Prisma.Decimal(0);
      const dueAmount = grandTotal.sub(totalPaid).greaterThan(0)
        ? grandTotal.sub(totalPaid)
        : new Prisma.Decimal(0);
      const paidAmount = grandTotal.sub(dueAmount);

      let effectiveStatus = status;
      if (status === 'PAY_LATER' && dueAmount.lte(0)) {
        effectiveStatus = 'COMPLETED';
      }

      let saleNote = dto.note?.trim() || null;
      if (advanceDec.greaterThan(0)) {
        const advNote = `Advance: ${advanceDec.toFixed(2)}`;
        saleNote = saleNote ? `${saleNote} | ${advNote}` : advNote;
      }

      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          customerId: dto.customerId,
          branchId: dto.branchId,
          totalAmount,
          discount,
          tax,
          grandTotal,
          servicesTotal,
          paidAmount,
          advanceApplied: advanceDec,
          changeAmount,
          dueAmount,
          paymentMethod: dto.paymentMethod,
          paymentAccountId: dto.paymentAccountId,
          status: effectiveStatus,
          note: saleNote,
        },
      });

      if (advanceDec.greaterThan(0)) {
        await tx.customer.update({
          where: { id: dto.customerId! },
          data: { totalAdvance: { decrement: advanceDec } },
        });
      }

      for (const item of dto.items) {
        const itemDiscount = new Prisma.Decimal(item.discount ?? 0);
        const itemTotal = new Prisma.Decimal(
          item.unitPrice * item.quantity,
        ).sub(itemDiscount);

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            storeProductId: item.storeProductId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: itemDiscount,
            total: itemTotal,
          },
        });

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: { quantity: { decrement: item.quantity } },
        });

        const batch = await tx.batch.findFirst({
          where: {
            storeProductId: item.storeProductId,
            availableQty: { gt: 0 },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (batch) {
          const deductQty = Math.min(batch.availableQty, item.quantity);
          await tx.batch.update({
            where: { id: batch.id },
            data: {
              availableQty: { decrement: deductQty },
              soldQty: { increment: deductQty },
            },
          });
        }

        if (item.serialNumbers?.length) {
          await tx.serialNumber.updateMany({
            where: { serial: { in: item.serialNumbers } },
            data: { status: 'SOLD', saleItemId: saleItem.id },
          });
        }
      }

      if (effectiveStatus === 'COMPLETED') {
        const providedPayments = Array.isArray(dto.payments)
          ? dto.payments
              .map((p) => ({
                accountId: Number(p.accountId),
                amount: Number(p.amount ?? 0),
              }))
              .filter((p) => Number.isFinite(p.accountId) && p.accountId > 0 && p.amount > 0)
          : [];

        if (providedPayments.length > 0) {
          for (const p of providedPayments) {
            const alloc = new Prisma.Decimal(p.amount);
            if (alloc.lte(0)) continue;

            await tx.transaction.create({
              data: {
                accountId: p.accountId,
                type: 'CREDIT',
                amount: alloc,
                reference: invoiceNumber,
                description: `Sale payment - ${invoiceNumber}`,
              },
            });

            await tx.account.update({
              where: { id: p.accountId },
              data: { balance: { increment: alloc } },
            });
          }
        } else if (dto.paymentAccountId && totalCashGross.greaterThan(0)) {
          await tx.transaction.create({
            data: {
              accountId: dto.paymentAccountId,
              type: 'CREDIT',
              amount: totalCashGross,
              reference: invoiceNumber,
              description: `Sale payment - ${invoiceNumber}`,
            },
          });

          await tx.account.update({
            where: { id: dto.paymentAccountId },
            data: { balance: { increment: totalCashGross } },
          });
        }
      }

      return tx.sale.findUnique({
        where: { id: sale.id },
        include: {
          items: {
            include: {
              storeProduct: {
                include: { product: true, productVariant: true },
              },
              serialNumbers: true,
            },
          },
          customer: true,
          branch: true,
          paymentAccount: true,
        },
      });
    });
  }

  async completePaylater(saleId: number, dto: CompletePaylaterDto) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.status !== 'PAY_LATER') {
      throw new BadRequestException('Sale is not in PAY_LATER status');
    }

    return this.prisma.$transaction(async (tx) => {
      const grossPaid = new Prisma.Decimal(dto.paidAmount);
      const changeAmount = grossPaid.sub(sale.grandTotal).greaterThan(0)
        ? grossPaid.sub(sale.grandTotal)
        : new Prisma.Decimal(0);
      const paidAmount = grossPaid.sub(changeAmount);
      const dueAmount = sale.grandTotal.sub(paidAmount).greaterThan(0)
        ? sale.grandTotal.sub(paidAmount)
        : new Prisma.Decimal(0);

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          status: 'COMPLETED',
          paidAmount,
          changeAmount,
          dueAmount,
          paymentMethod: dto.paymentMethod,
          paymentAccountId: dto.paymentAccountId,
        },
        include: {
          items: true,
          customer: true,
          branch: true,
          paymentAccount: true,
        },
      });

      if (dto.paymentAccountId) {
        const netReceived = paidAmount;
        await tx.transaction.create({
          data: {
            accountId: dto.paymentAccountId,
            type: 'CREDIT',
            amount: netReceived,
            reference: sale.invoiceNumber,
            description: `Pay-later completion - ${sale.invoiceNumber}`,
          },
        });

        await tx.account.update({
          where: { id: dto.paymentAccountId },
          data: { balance: { increment: netReceived } },
        });
      }

      return updated;
    });
  }

  async getSalePayments(saleId: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      select: { invoiceNumber: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    return this.prisma.transaction.findMany({
      where: { reference: sale.invoiceNumber, type: 'CREDIT' },
      orderBy: { createdAt: 'desc' },
      include: { account: true },
    });
  }

  async addPayment(saleId: number, dto: AddSalePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId } });
      if (!sale) throw new NotFoundException('Sale not found');
      if (sale.status === 'RETURNED') {
        throw new BadRequestException('Cannot pay a returned sale');
      }
      if (sale.dueAmount.lte(0)) {
        throw new BadRequestException('No due amount remaining for this sale');
      }

      const dueBefore = sale.dueAmount;
      const requested = new Prisma.Decimal(dto.amount);
      if (requested.gt(dueBefore)) {
        throw new BadRequestException('Amount cannot exceed due amount');
      }

      const account = await tx.account.findUnique({ where: { id: dto.accountId } });
      if (!account) throw new NotFoundException('Account not found');

      const paidAmount = sale.paidAmount.add(requested);
      const dueAmount = sale.grandTotal.sub(paidAmount).greaterThan(0)
        ? sale.grandTotal.sub(paidAmount)
        : new Prisma.Decimal(0);

      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          paidAmount,
          dueAmount,
          changeAmount: new Prisma.Decimal(0),
          paymentAccountId: sale.paymentAccountId ?? dto.accountId,
          status: dueAmount.greaterThan(0) ? sale.status : 'COMPLETED',
        },
      });

      const txn = await tx.transaction.create({
        data: {
          accountId: dto.accountId,
          type: 'CREDIT',
          amount: requested,
          reference: sale.invoiceNumber,
          description: dto.note?.trim()
            ? `Sale due payment - ${sale.invoiceNumber} (${dto.note.trim()})`
            : `Sale due payment - ${sale.invoiceNumber}`,
        },
        include: { account: true },
      });

      await tx.account.update({
        where: { id: dto.accountId },
        data: { balance: { increment: requested } },
      });

      return { sale: updatedSale, payment: txn };
    });
  }

  private saleWhereFromDto(
    query: Pick<
      SaleQueryDto,
      'branchId' | 'customerId' | 'status' | 'search' | 'dateFrom' | 'dateTo'
    >,
  ): any {
    const { branchId, customerId, status, search, dateFrom, dateTo } = query;
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { customer: { name: { contains: search } } },
        { customer: { phone: { contains: search } } },
      ];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.createdAt.lte = bdDayEndUtc(dateTo);
    }
    return where;
  }

  private saleReturnWhereFromDto(
    query: Pick<
      SaleReturnQueryDto,
      'branchId' | 'search' | 'dateFrom' | 'dateTo'
    >,
  ): any {
    const { branchId, search, dateFrom, dateTo } = query;
    const parts: any[] = [];
    if (branchId) {
      parts.push({ sale: { branchId } });
    }
    if (search) {
      parts.push({
        OR: [
          { reason: { contains: search } },
          { sale: { invoiceNumber: { contains: search } } },
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

  async findAll(query: SaleQueryDto) {
    const { page = 1, limit = 16, sort, order = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where = this.saleWhereFromDto(query);

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          customer: true,
          branch: true,
          order: { select: { id: true, orderNumber: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getSaleListSummary(query: SaleQueryDto) {
    const where = this.saleWhereFromDto(query);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const todayWhere = {
      AND: [where, { createdAt: { gte: startOfToday, lte: endOfToday } }],
    };

    const [total, sumAll, todayCount, todaySum] = await Promise.all([
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({
        where,
        _sum: { grandTotal: true },
      }),
      this.prisma.sale.count({ where: todayWhere }),
      this.prisma.sale.aggregate({
        where: todayWhere,
        _sum: { grandTotal: true },
      }),
    ]);

    return {
      total,
      totalRevenue: Number(sumAll._sum.grandTotal ?? 0),
      todaySales: todayCount,
      todayRevenue: Number(todaySum._sum.grandTotal ?? 0),
    };
  }

  async findReturns(query: SaleReturnQueryDto) {
    const { page = 1, limit = 16 } = query;
    const skip = (page - 1) * limit;
    const where = this.saleReturnWhereFromDto(query);

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
    const where = this.saleReturnWhereFromDto(query);
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

  async findOne(id: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        customer: true,
        branch: true,
        order: { select: { id: true, orderNumber: true } },
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
            serialNumbers: true,
          },
        },
        returns: {
          include: { items: true },
        },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const returnRows =
      sale.returns?.flatMap((r) =>
        (r.items ?? []).map((it) => ({
          saleItemId: it.saleItemId,
          storeProductId: it.storeProductId,
          quantity: it.quantity,
        })),
      ) ?? [];

    const itemsWithAvail = sale.items.map((si) => {
      const sameSp = sale.items.filter((x) => x.storeProductId === si.storeProductId);
      let returned = 0;
      for (const r of returnRows) {
        if (r.saleItemId === si.id) returned += r.quantity;
        else if (
          r.saleItemId == null &&
          r.storeProductId === si.storeProductId &&
          sameSp.length === 1
        ) {
          returned += r.quantity;
        }
      }
      const availableReturnQty = Math.max(0, si.quantity - returned);
      return {
        ...si,
        returnedQuantity: returned,
        availableReturnQty,
      };
    });

    return { ...sale, items: itemsWithAvail };
  }

  async getPayLaterStats(query: PayLaterQueryDto) {
    const { branchId, search } = query;
    const where: any = { status: 'PAY_LATER' as const };
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { customer: { name: { contains: search } } },
        { customer: { phone: { contains: search } } },
      ];
    }
    const [total, sum] = await Promise.all([
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({
        where,
        _sum: { dueAmount: true },
      }),
    ]);
    return {
      total,
      totalDueAmount: Number(sum._sum.dueAmount ?? 0),
    };
  }

  async getPayLaterSales(query: PayLaterQueryDto) {
    const { page = 1, limit = 16, search, branchId } = query;
    const skip = (page - 1) * limit;

    const where: any = { status: 'PAY_LATER' as const };
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { customer: { name: { contains: search } } },
        { customer: { phone: { contains: search } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: true,
          branch: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  private composeSaleReturnReason(dto: CreateSaleReturnDto): string | null {
    const blocks: string[] = [];
    if (dto.returnDate?.trim()) blocks.push(`Return date: ${dto.returnDate.trim()}`);
    if (dto.reference?.trim()) blocks.push(`Reference: ${dto.reference.trim()}`);
    if (dto.responsiblePerson?.trim()) {
      blocks.push(`Responsible: ${dto.responsiblePerson.trim()}`);
    }
    if (dto.notes?.trim()) blocks.push(`Notes: ${dto.notes.trim()}`);
    if (dto.reason?.trim()) blocks.push(dto.reason.trim());
    const s = blocks.join('\n').trim();
    return s.length ? s : null;
  }

  private lineDamageAmount(
    lineTotal: Prisma.Decimal,
    type?: string,
    rawVal?: number,
  ): Prisma.Decimal {
    if (!type || type === 'none' || rawVal == null || rawVal <= 0) {
      return new Prisma.Decimal(0);
    }
    const val = new Prisma.Decimal(rawVal);
    if (type === 'percentage') {
      const p = Prisma.Decimal.min(val, new Prisma.Decimal(100));
      return lineTotal.mul(p).div(new Prisma.Decimal(100));
    }
    if (type === 'fixed') {
      return Prisma.Decimal.min(lineTotal, val);
    }
    return new Prisma.Decimal(0);
  }

  private resolveSaleItemForReturn(
    sale: { items: { id: number; storeProductId: number; quantity: number }[] },
    dtoItem: { saleItemId?: number; storeProductId: number },
  ) {
    if (dtoItem.saleItemId != null) {
      const si = sale.items.find(
        (i) => i.id === dtoItem.saleItemId && i.storeProductId === dtoItem.storeProductId,
      );
      if (!si) {
        throw new BadRequestException(
          `saleItemId ${dtoItem.saleItemId} does not match this sale / store product`,
        );
      }
      return si;
    }
    const matches = sale.items.filter(
      (i) => i.storeProductId === dtoItem.storeProductId,
    );
    if (matches.length === 1) return matches[0];
    throw new BadRequestException(
      `saleItemId is required when multiple invoice lines use store product #${dtoItem.storeProductId}`,
    );
  }

  private priorReturnedForSaleLine(
    saleItems: { id: number; storeProductId: number; quantity: number }[],
    returnRows: { saleItemId: number | null; storeProductId: number; quantity: number }[],
    si: { id: number; storeProductId: number },
  ): number {
    const sameSp = saleItems.filter((x) => x.storeProductId === si.storeProductId);
    let returned = 0;
    for (const r of returnRows) {
      if (r.saleItemId === si.id) returned += r.quantity;
      else if (
        r.saleItemId == null &&
        r.storeProductId === si.storeProductId &&
        sameSp.length === 1
      ) {
        returned += r.quantity;
      }
    }
    return returned;
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

    const reasonStored = this.composeSaleReturnReason(dto);

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
        const saleItem = this.resolveSaleItemForReturn(
          sale,
          item,
        ) as (typeof sale.items)[number];
        const already = this.priorReturnedForSaleLine(
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
        const damage = this.lineDamageAmount(
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

      const refund = refundTotal;
      const due = new Prisma.Decimal(sale.dueAmount ?? 0);
      const adv = new Prisma.Decimal(sale.advanceApplied ?? 0);
      const grand = new Prisma.Decimal(sale.grandTotal ?? 0);

      let dueReduction = new Prisma.Decimal(0);
      let advanceRefund = new Prisma.Decimal(0);
      let cashRefund = new Prisma.Decimal(0);
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
        cashRefund = afterDue.sub(advanceRefund);
      }

      const needsCashPayout = cashRefund.greaterThan(0.005);
      const saleReturn = await tx.saleReturn.create({
        data: {
          saleId: dto.saleId,
          reason: reasonStored ?? dto.reason ?? null,
          totalAmount: returnGross,
          refundAmount: refundTotal,
          returnGain: gainTotal,
          status: needsCashPayout ? 'pending' : 'completed',
          pendingCashRefund: cashRefund,
          cashRefundPaid: new Prisma.Decimal(0),
          items: { create: returnItemsCreate },
        },
        include: { items: true },
      });

      for (const p of prepared) {
        const item = p.dto;
        const saleItem = p.saleItem;

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: { quantity: { increment: item.quantity } },
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
        if (sns.length > 0) {
          for (const serial of sns) {
            await tx.serialNumber.updateMany({
              where: {
                serial,
                saleItemId: saleItem.id,
                status: 'SOLD',
              },
              data: { status: 'RETURNED', saleItemId: null },
            });
          }
        }
      }

      const newReturnRows = prepared.map((p) => ({
        saleItemId: p.saleItem.id,
        storeProductId: p.dto.storeProductId,
        quantity: p.dto.quantity,
      }));

      const allSold = sale.items.every((si) => {
        const returned = this.priorReturnedForSaleLine(
          saleItems,
          [...priorRows, ...newReturnRows],
          si,
        );
        return returned >= si.quantity;
      });

      await tx.sale.update({
        where: { id: dto.saleId },
        data: { status: allSold ? 'RETURNED' : 'PARTIAL_RETURN' },
      });

      if (refund.greaterThan(0)) {
        const saleMoneyPatch: Prisma.SaleUpdateInput = {};
        if (dueReduction.greaterThan(0)) {
          saleMoneyPatch.dueAmount = { decrement: dueReduction };
        }
        if (advanceRefund.greaterThan(0)) {
          saleMoneyPatch.advanceApplied = { decrement: advanceRefund };
        }
        if (Object.keys(saleMoneyPatch).length > 0) {
          await tx.sale.update({
            where: { id: dto.saleId },
            data: saleMoneyPatch,
          });
        }
        if (advanceRefund.greaterThan(0) && sale.customerId) {
          await tx.customer.update({
            where: { id: sale.customerId },
            data: { totalAdvance: { increment: advanceRefund } },
          });
        }
      }

      return saleReturn;
    });
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
    const refund = Number(ret.refundAmount);
    const gain = Number(ret.returnGain);
    const pendingCap = Number(ret.pendingCashRefund ?? 0);
    const cashPaid = Number(ret.cashRefundPaid ?? 0);
    const remainingCash = Math.max(0, Math.round((pendingCap - cashPaid) * 100) / 100);
    const status = ret.status ?? 'completed';

    const accounting = {
      grossReturnValue: gross,
      refundToCustomer: refund,
      returnGainRetained: gain,
      status,
      pendingCashRefund: pendingCap,
      cashRefundPaid: cashPaid,
      remainingCashRefund: remainingCash,
      stockRestored: true,
      customerAdvanceCredited: refund > 0 && ret.sale.customerId != null,
      /** True once any cash refund payment was posted from a finance account. */
      accountDebited: cashPaid > 0.005,
      paymentAccountName: ret.sale.paymentAccount?.name ?? null,
      refundAccountName: ret.refundAccount?.name ?? null,
      steps: [
        'Store quantity was increased for each returned SKU.',
        'Latest batch sold quantity was reduced where possible.',
        'Sale status set to RETURNED or PARTIAL_RETURN when every invoice line is fully returned.',
      ] as string[],
    };
    if (gain > 0) {
      accounting.steps.push(
        `Return gain (damage retention): ${gain.toFixed(2)} — shown under Profit & Loss → Return gain.`,
      );
    }
    if (refund > 0) {
      accounting.steps.push(
        'Customer refund allocation at return time: sale due was reduced first, then customer advance wallet was credited proportionally (same rule as before).',
      );
      if (pendingCap > 0.005) {
        accounting.steps.push(
          `Cash/bank leg (${pendingCap.toFixed(2)}): recorded as pending — pay out from a finance account on this page (seller-admin style). Paid so far: ${cashPaid.toFixed(2)}; remaining: ${remainingCash.toFixed(2)}.`,
        );
      } else {
        accounting.steps.push(
          'No separate cash payout was required (refund was fully absorbed by due and advance).',
        );
      }
    }

    return {
      ...ret,
      items,
      accounting,
    };
  }

  async recordReturnCashRefund(
    returnId: number,
    dto: PatchSaleReturnRefundDto,
  ) {
    const amount = new Prisma.Decimal(dto.paymentAmount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('paymentAmount must be greater than 0');
    }

    await this.prisma.$transaction(async (tx) => {
      const ret = await tx.saleReturn.findUnique({
        where: { id: returnId },
        include: { sale: { select: { id: true, invoiceNumber: true } } },
      });
      if (!ret) throw new NotFoundException('Sale return not found');
      if (ret.status === 'cancelled') {
        throw new BadRequestException('This return is cancelled');
      }

      const pendingCap = new Prisma.Decimal(ret.pendingCashRefund ?? 0);
      const paidSoFar = new Prisma.Decimal(ret.cashRefundPaid ?? 0);
      const remaining = pendingCap.sub(paidSoFar);

      if (remaining.lessThanOrEqualTo(0.005)) {
        throw new BadRequestException(
          'No cash refund is pending for this return',
        );
      }
      if (amount.sub(remaining).greaterThan(0.01)) {
        throw new BadRequestException(
          `Payment cannot exceed remaining ${remaining.toFixed(2)}`,
        );
      }

      const acc = await tx.account.findUnique({
        where: { id: dto.refundAccountId },
      });
      if (!acc) throw new NotFoundException('Account not found');
      if (!acc.isActive) {
        throw new BadRequestException('Account is not active');
      }
      const bal = new Prisma.Decimal(acc.balance);
      if (amount.sub(bal).greaterThan(0.01)) {
        throw new BadRequestException('Insufficient account balance');
      }

      await tx.transaction.create({
        data: {
          accountId: dto.refundAccountId,
          type: 'DEBIT',
          amount,
          reference: ret.sale.invoiceNumber,
          description: `Sale return #${ret.id} cash refund — ${ret.sale.invoiceNumber}`,
        },
      });
      await tx.account.update({
        where: { id: dto.refundAccountId },
        data: { balance: { decrement: amount } },
      });

      const newPaid = paidSoFar.add(amount);
      const done = newPaid.add(new Prisma.Decimal(0.01)).greaterThanOrEqualTo(pendingCap);

      await tx.saleReturn.update({
        where: { id: returnId },
        data: {
          cashRefundPaid: newPaid,
          refundAccountId: dto.refundAccountId,
          status: done ? 'completed' : 'pending',
        },
      });
    });

    return this.findReturnOne(returnId);
  }

  async getProductTransactions(query: ProductTransactionQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const skip = (page - 1) * limit;

    const start = new Date(query.startDate);
    const end = new Date(query.endDate);

    const saleWhere: Prisma.SaleWhereInput = {
      status: { not: 'RETURNED' },
      createdAt: { gte: start, lte: end },
    };
    if (query.branchId != null && Number.isFinite(query.branchId)) {
      saleWhere.branchId = query.branchId;
    }

    const where: Prisma.SaleItemWhereInput = { sale: saleWhere };

    const [total, items] = await Promise.all([
      this.prisma.saleItem.count({ where }),
      this.prisma.saleItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sale: { createdAt: 'desc' } }, { id: 'desc' }],
        include: {
          sale: { include: { branch: true } },
          storeProduct: {
            include: {
              product: {
                include: { category: true, brand: true },
              },
              productVariant: {
                include: {
                  attributes: {
                    include: {
                      attributeValue: { include: { attribute: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const storeProductIds = [
      ...new Set(items.map((i) => i.storeProductId)),
    ] as number[];

    const costAggs =
      storeProductIds.length > 0
        ? await this.prisma.batch.groupBy({
            by: ['storeProductId'],
            where: { storeProductId: { in: storeProductIds } },
            _avg: { purchaseCost: true },
          })
        : [];

    const costByStore = new Map<number, number>();
    for (const row of costAggs) {
      costByStore.set(
        row.storeProductId,
        Number(row._avg.purchaseCost ?? 0),
      );
    }

    const saleIds = [...new Set(items.map((i) => i.saleId))];
    const salesForSum =
      saleIds.length > 0
        ? await this.prisma.sale.findMany({
            where: { id: { in: saleIds } },
            select: {
              id: true,
              grandTotal: true,
              items: { select: { total: true } },
            },
          })
        : [];

    const lineSumBySale = new Map<number, Prisma.Decimal>();
    for (const s of salesForSum) {
      let sum = new Prisma.Decimal(0);
      for (const it of s.items) {
        sum = sum.add(it.total);
      }
      lineSumBySale.set(s.id, sum);
    }

    const data = items.map((row) => {
      const sale = row.sale;
      const sp = row.storeProduct;
      const product = sp.product;
      const variant = sp.productVariant;

      const qty = row.quantity;
      const unitPrice = Number(row.unitPrice);
      const lineSub = Number(row.total);
      const costPrice = costByStore.get(sp.id) ?? 0;
      const costLine = qty * costPrice;

      const sumLines = lineSumBySale.get(sale.id) ?? new Prisma.Decimal(0);
      const grandTotal = new Prisma.Decimal(sale.grandTotal);
      const lineDec = new Prisma.Decimal(row.total);
      const netRevenueDec = sumLines.gt(0)
        ? grandTotal.mul(lineDec).div(sumLines)
        : lineDec;
      const netRevenue = Number(netRevenueDec);
      const netProfit = netRevenue - costLine;

      const attrs = variant?.attributes?.map((a) => ({
        attribute: { name: a.attributeValue.attribute.name },
        attributeValue: { value: a.attributeValue.value },
      }));

      return {
        id: String(row.id),
        productName: product.name,
        sku: product.sku || variant?.sku || '',
        quantity: qty,
        unitPrice,
        costPrice,
        totalPrice: lineSub,
        lineSubtotal: lineSub,
        netRevenue,
        netProfit,
        saleOrder: {
          id: String(sale.id),
          invoiceNo: sale.invoiceNumber,
          orderNo: sale.invoiceNumber,
          orderType: 'pos',
          orderDate: sale.createdAt.toISOString(),
          grandTotal: Number(sale.grandTotal),
          servicesTotal: 0,
          branch: sale.branch
            ? { id: String(sale.branch.id), name: sale.branch.name }
            : undefined,
        },
        product: {
          sellerCategory: product.category
            ? { id: String(product.category.id), name: product.category.name }
            : null,
          sellerBrand: product.brand
            ? { id: String(product.brand.id), name: product.brand.name }
            : null,
        },
        variant: variant
          ? {
              id: String(variant.id),
              sku: variant.sku,
              attributes: attrs,
            }
          : undefined,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async searchBySerial(serial: string) {
    const serialNumber = await this.prisma.serialNumber.findUnique({
      where: { serial },
      include: {
        batch: {
          include: {
            storeProduct: {
              include: {
                product: {
                  include: {
                    images: { take: 1, orderBy: { sortOrder: 'asc' } },
                  },
                },
                branch: true,
              },
            },
          },
        },
        saleItem: {
          include: {
            sale: { include: { customer: true } },
          },
        },
      },
    });
    if (!serialNumber) throw new NotFoundException('Serial number not found');
    return serialNumber;
  }
}
