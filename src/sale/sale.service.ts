import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSaleDto } from './dto/create-sale.dto.js';
import { CompletePaylaterDto } from './dto/complete-paylater.dto.js';
import { AddSalePaymentDto } from './dto/add-sale-payment.dto.js';
import { CreateSaleReturnDto } from './dto/create-sale-return.dto.js';
import { SaleQueryDto } from './dto/sale-query.dto.js';
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
      const grandTotal = totalAmount.sub(discount).add(tax);

      const status = dto.status ?? 'COMPLETED';
      const requestedPaid = new Prisma.Decimal(dto.paidAmount ?? grandTotal);
      const grossPaid =
        status === 'PAY_LATER' ? new Prisma.Decimal(0) : requestedPaid;
      const changeAmount = grossPaid.sub(grandTotal).greaterThan(0)
        ? grossPaid.sub(grandTotal)
        : new Prisma.Decimal(0);
      const paidAmount = grossPaid.sub(changeAmount);
      const dueAmount = grandTotal.sub(paidAmount).greaterThan(0)
        ? grandTotal.sub(paidAmount)
        : new Prisma.Decimal(0);

      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          customerId: dto.customerId,
          branchId: dto.branchId,
          totalAmount,
          discount,
          tax,
          grandTotal,
          paidAmount,
          changeAmount,
          dueAmount,
          paymentMethod: dto.paymentMethod,
          paymentAccountId: dto.paymentAccountId,
          status,
          note: dto.note,
        },
      });

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

      if (status === 'COMPLETED') {
        const netReceived = paidAmount;
        const providedPayments = Array.isArray(dto.payments)
          ? dto.payments
              .map((p) => ({
                accountId: Number(p.accountId),
                amount: Number(p.amount ?? 0),
              }))
              .filter((p) => Number.isFinite(p.accountId) && p.accountId > 0 && p.amount > 0)
          : [];

        if (providedPayments.length > 0) {
          let remaining = netReceived;
          for (const p of providedPayments) {
            if (remaining.lte(0)) break;
            const alloc = Prisma.Decimal.min(remaining, new Prisma.Decimal(p.amount));
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

            remaining = remaining.sub(alloc);
          }
        } else if (dto.paymentAccountId) {
          await tx.transaction.create({
            data: {
              accountId: dto.paymentAccountId,
              type: 'CREDIT',
              amount: netReceived,
              reference: invoiceNumber,
              description: `Sale payment - ${invoiceNumber}`,
            },
          });

          await tx.account.update({
            where: { id: dto.paymentAccountId },
            data: { balance: { increment: netReceived } },
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
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
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
      if (dateFrom) range.gte = new Date(dateFrom);
      if (dateTo) range.lte = new Date(dateTo);
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

    const [total, sumAgg, todayCount] = await Promise.all([
      this.prisma.saleReturn.count({ where }),
      this.prisma.saleReturn.aggregate({
        where,
        _sum: { totalAmount: true },
      }),
      this.prisma.saleReturn.count({ where: todayWhere }),
    ]);

    return {
      total,
      totalReturnAmount: Number(sumAgg._sum.totalAmount ?? 0),
      todayReturns: todayCount,
    };
  }

  async findOne(id: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        customer: true,
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
            serialNumbers: true,
          },
        },
        returns: {
          include: { items: true },
        },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
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

  async createReturn(dto: CreateSaleReturnDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: dto.saleId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    return this.prisma.$transaction(async (tx) => {
      let returnTotal = new Prisma.Decimal(0);
      const returnItemsData = dto.items.map((item) => {
        const itemTotal = new Prisma.Decimal(item.unitPrice * item.quantity);
        returnTotal = returnTotal.add(itemTotal);
        return {
          storeProductId: item.storeProductId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: itemTotal,
        };
      });

      const saleReturn = await tx.saleReturn.create({
        data: {
          saleId: dto.saleId,
          reason: dto.reason,
          totalAmount: returnTotal,
          items: { create: returnItemsData },
        },
        include: { items: true },
      });

      for (const item of dto.items) {
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
          await tx.batch.update({
            where: { id: batch.id },
            data: {
              availableQty: { increment: restoreQty },
              soldQty: { decrement: restoreQty },
              returnQty: { increment: restoreQty },
            },
          });
        }

        const saleItem = sale.items.find(
          (si) => si.storeProductId === item.storeProductId,
        );
        if (saleItem) {
          await tx.serialNumber.updateMany({
            where: { saleItemId: saleItem.id, status: 'SOLD' },
            data: { status: 'RETURNED', saleItemId: null },
          });
        }
      }

      const allReturnedQty = await this.getTotalReturnedQuantities(
        tx,
        dto.saleId,
      );
      const allSold = sale.items.every((si) => {
        const returned = allReturnedQty.get(si.storeProductId) ?? 0;
        return returned >= si.quantity;
      });

      await tx.sale.update({
        where: { id: dto.saleId },
        data: { status: allSold ? 'RETURNED' : 'PARTIAL_RETURN' },
      });

      if (sale.paymentAccountId) {
        await tx.transaction.create({
          data: {
            accountId: sale.paymentAccountId,
            type: 'DEBIT',
            amount: returnTotal,
            reference: sale.invoiceNumber,
            description: `Sale return - ${sale.invoiceNumber}`,
          },
        });

        await tx.account.update({
          where: { id: sale.paymentAccountId },
          data: { balance: { decrement: returnTotal } },
        });
      }

      return saleReturn;
    });
  }

  private async getTotalReturnedQuantities(
    tx: Prisma.TransactionClient,
    saleId: number,
  ): Promise<Map<number, number>> {
    const returns = await tx.saleReturn.findMany({
      where: { saleId },
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
