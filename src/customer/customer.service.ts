import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { QuickTransactionDto } from './dto/quick-transaction.dto.js';
import {
  CreateCustomerTransactionDto,
  CustomerTransactionTypeInput,
} from './dto/create-customer-transaction.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';
import {
  CustomerTransactionType,
  Prisma,
  TransactionType,
} from '@prisma/client';

@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) {}

  private whereFromSearch(search?: string): Prisma.CustomerWhereInput {
    if (!search) return {};
    return {
      OR: [{ name: { contains: search } }, { phone: { contains: search } }],
    };
  }

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 16, search, sort, order = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where = this.whereFromSearch(search);

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          _count: { select: { orders: true, sales: true } },
          sales: {
            where: { dueAmount: { gt: 0 } },
            select: { dueAmount: true },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getSummary(query: PaginationDto) {
    const where = this.whereFromSearch(query.search);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [total, newThisMonth, dueCustomers, activeCustomers, salesDueAgg] =
      await Promise.all([
        this.prisma.customer.count({ where }),
        this.prisma.customer.count({
          where: { AND: [where, { createdAt: { gte: monthStart } }] },
        }),
        this.prisma.customer.count({
          where: {
            AND: [
              where,
              {
                sales: { some: { dueAmount: { gt: 0 } } },
              },
            ],
          },
        }),
        this.prisma.customer.count({
          where: { AND: [where, { sales: { some: {} } }] },
        }),
        this.prisma.sale.aggregate({
          where: {
            dueAmount: { gt: 0 },
            customer: where,
          },
          _sum: { dueAmount: true },
        }),
      ]);

    return {
      total,
      active: activeCustomers,
      totalDue: Number(salesDueAgg._sum.dueAmount ?? 0),
      newThisMonth,
      dueCustomers,
    };
  }

  async findOne(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        orders: { orderBy: { createdAt: 'desc' }, take: 20 },
        sales: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const stats = await this.getCustomerStats(id);
    return { ...customer, ...stats };
  }

  async create(dto: CreateCustomerDto) {
    const normalizedPhone = String(dto.phone ?? '').trim();
    if (!normalizedPhone) {
      throw new BadRequestException('Phone is required');
    }
    const existingByPhone = await this.prisma.customer.findFirst({
      where: { phone: normalizedPhone },
      select: { id: true },
    });
    if (existingByPhone) {
      throw new BadRequestException('Customer phone must be unique');
    }
    return this.prisma.customer.create({ data: dto });
  }

  async update(id: number, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (dto.phone != null) {
      const normalizedPhone = String(dto.phone).trim();
      if (!normalizedPhone) {
        throw new BadRequestException('Phone is required');
      }
      const existingByPhone = await this.prisma.customer.findFirst({
        where: { phone: normalizedPhone, id: { not: id } },
        select: { id: true },
      });
      if (existingByPhone) {
        throw new BadRequestException('Customer phone must be unique');
      }
    }
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.customer.delete({ where: { id } });
  }

  async getDueCustomers(query: PaginationDto) {
    const { page = 1, limit = 16, search } = query;
    const skip = (page - 1) * limit;
    const searchWhere = this.whereFromSearch(search);
    const dueWhere: Prisma.CustomerWhereInput = {
      sales: { some: { dueAmount: { gt: 0 } } },
    };
    const where: Prisma.CustomerWhereInput = { AND: [dueWhere, searchWhere] };

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: { select: { orders: true, sales: true } },
          sales: {
            where: { dueAmount: { gt: 0 } },
            select: {
              id: true,
              invoiceNumber: true,
              grandTotal: true,
              paidAmount: true,
              dueAmount: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(customers, total, page, limit);
  }

  async addQuickTransaction(customerId: number, dto: QuickTransactionDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    return this.prisma.customer.update({
      where: { id: customerId },
      data: {
        totalAdvance: {
          increment: new Prisma.Decimal(dto.amount),
        },
      },
    });
  }

  async getCustomerStats(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { totalAdvance: true, manualDue: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const salesAgg = await this.prisma.sale.aggregate({
      where: { customerId: id },
      _sum: { grandTotal: true, paidAmount: true, dueAmount: true },
    });

    const totalAdvance = customer.totalAdvance;
    const totalPurchase = salesAgg._sum.grandTotal ?? new Prisma.Decimal(0);
    const totalPaid = salesAgg._sum.paidAmount ?? new Prisma.Decimal(0);
    const salesDue = salesAgg._sum.dueAmount ?? new Prisma.Decimal(0);
    const manualDue = new Prisma.Decimal(customer.manualDue ?? 0);
    const totalDue = salesDue.add(manualDue);

    return {
      totalAdvance,
      totalPurchase,
      totalPaid,
      totalDue: totalDue.greaterThan(0) ? totalDue : new Prisma.Decimal(0),
    };
  }

  async listCustomerTransactions(customerId: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const rows = await this.prisma.customerTransaction.findMany({
      where: { customerId },
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      include: {
        account: { select: { id: true, name: true, type: true } },
        sale: { select: { id: true, invoiceNumber: true } },
      },
    });

    const data = rows.map((r) => ({
      id: r.id,
      type: String(r.type).toLowerCase(),
      amount: Number(r.amount),
      date: r.transactionDate.toISOString(),
      transactionDate: r.transactionDate.toISOString(),
      note: r.note,
      saleId: r.saleId,
      account: r.account
        ? {
            id: r.account.id,
            accountName: r.account.name,
            accountType: String(r.account.type),
          }
        : null,
      invoice: r.sale
        ? { id: r.sale.id, invoiceNumber: r.sale.invoiceNumber }
        : null,
    }));

    return { data };
  }

  async createCustomerTransaction(
    customerId: number,
    dto: CreateCustomerTransactionDto,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });
    if (!account) throw new NotFoundException('Account not found');
    if (!account.isActive) {
      throw new BadRequestException('Account is inactive');
    }

    const amount = new Prisma.Decimal(dto.amount);
    const prismaType =
      dto.type === CustomerTransactionTypeInput.payment
        ? CustomerTransactionType.PAYMENT
        : dto.type === CustomerTransactionTypeInput.advance
          ? CustomerTransactionType.ADVANCE
          : CustomerTransactionType.DUE;

    const postedAt = dto.transactionDate
      ? new Date(dto.transactionDate)
      : new Date();
    if (Number.isNaN(postedAt.getTime())) {
      throw new BadRequestException('Invalid transactionDate');
    }

    type SalePay = {
      id: number;
      dueAmount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      grandTotal: Prisma.Decimal;
      paymentAccountId: number | null;
    };

    let linkedSale: SalePay | null = null;

    if (prismaType === CustomerTransactionType.PAYMENT) {
      if (dto.saleId) {
        const s = await this.prisma.sale.findFirst({
          where: { id: dto.saleId, customerId },
        });
        if (!s) {
          throw new NotFoundException('Sale not found for this customer');
        }
        if (s.status === 'RETURNED') {
          throw new BadRequestException('Cannot pay a returned sale');
        }
        if (new Prisma.Decimal(s.dueAmount).lte(0)) {
          throw new BadRequestException('No due on this sale');
        }
        if (amount.gt(s.dueAmount)) {
          throw new BadRequestException('Amount exceeds sale due');
        }
        linkedSale = {
          id: s.id,
          dueAmount: s.dueAmount,
          paidAmount: s.paidAmount,
          grandTotal: s.grandTotal,
          paymentAccountId: s.paymentAccountId,
        };
      } else {
        const manual = new Prisma.Decimal(customer.manualDue);
        if (manual.lte(0)) {
          throw new BadRequestException(
            'No manual due to pay; select an invoice or record a due first',
          );
        }
        if (amount.gt(manual)) {
          throw new BadRequestException('Amount exceeds customer manual due');
        }
      }
    } else if (prismaType === CustomerTransactionType.DUE) {
      const bal = new Prisma.Decimal(account.balance);
      if (amount.gt(bal)) {
        throw new BadRequestException('Insufficient account balance');
      }
    }

    const descBase =
      dto.note?.trim() ||
      `Customer ${dto.type} — ${customer.name}`;

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.customerTransaction.create({
        data: {
          customerId,
          type: prismaType,
          amount,
          accountId: dto.accountId,
          saleId: linkedSale?.id ?? null,
          note: dto.note?.trim() || null,
          transactionDate: postedAt,
        },
      });

      if (prismaType === CustomerTransactionType.PAYMENT) {
        if (linkedSale) {
          const newPaid = new Prisma.Decimal(linkedSale.paidAmount).add(amount);
          let newDue = new Prisma.Decimal(linkedSale.grandTotal).sub(newPaid);
          if (newDue.lt(0)) newDue = new Prisma.Decimal(0);

          await tx.sale.update({
            where: { id: linkedSale.id },
            data: {
              paidAmount: newPaid,
              dueAmount: newDue,
              paymentAccountId:
                linkedSale.paymentAccountId ?? dto.accountId,
              status: newDue.lte(0) ? 'COMPLETED' : 'PAY_LATER',
            },
          });
        } else {
          await tx.customer.update({
            where: { id: customerId },
            data: { manualDue: { decrement: amount } },
          });
        }

        await tx.transaction.create({
          data: {
            accountId: dto.accountId,
            type: TransactionType.CREDIT,
            amount,
            reference: `CUST-PAY-${customerId}-${row.id}`,
            description: descBase,
            createdAt: postedAt,
          },
        });
        await tx.account.update({
          where: { id: dto.accountId },
          data: { balance: { increment: amount } },
        });
      } else if (prismaType === CustomerTransactionType.ADVANCE) {
        await tx.customer.update({
          where: { id: customerId },
          data: { totalAdvance: { increment: amount } },
        });
        await tx.transaction.create({
          data: {
            accountId: dto.accountId,
            type: TransactionType.CREDIT,
            amount,
            reference: `CUST-ADV-${customerId}-${row.id}`,
            description: descBase,
            createdAt: postedAt,
          },
        });
        await tx.account.update({
          where: { id: dto.accountId },
          data: { balance: { increment: amount } },
        });
      } else {
        await tx.customer.update({
          where: { id: customerId },
          data: { manualDue: { increment: amount } },
        });
        await tx.transaction.create({
          data: {
            accountId: dto.accountId,
            type: TransactionType.DEBIT,
            amount,
            reference: `CUST-DUE-${customerId}-${row.id}`,
            description: descBase,
            createdAt: postedAt,
          },
        });
        await tx.account.update({
          where: { id: dto.accountId },
          data: { balance: { decrement: amount } },
        });
      }

      return tx.customerTransaction.findUnique({
        where: { id: row.id },
        include: {
          account: { select: { id: true, name: true, type: true } },
          sale: { select: { id: true, invoiceNumber: true } },
        },
      });
    });
  }

  async deleteCustomerTransaction(customerId: number, txId: number) {
    const row = await this.prisma.customerTransaction.findFirst({
      where: { id: txId, customerId },
      include: { sale: true },
    });
    if (!row) throw new NotFoundException('Transaction not found');

    const amount = new Prisma.Decimal(row.amount);

    return this.prisma.$transaction(async (tx) => {
      if (row.type === CustomerTransactionType.PAYMENT) {
        if (row.saleId && row.sale) {
          const s = row.sale;
          const newPaid = new Prisma.Decimal(s.paidAmount).minus(amount);
          const newDue = new Prisma.Decimal(s.dueAmount).plus(amount);
          await tx.sale.update({
            where: { id: row.saleId },
            data: {
              paidAmount: newPaid,
              dueAmount: newDue,
              status: newDue.lte(0) ? 'COMPLETED' : 'PAY_LATER',
            },
          });
        } else {
          await tx.customer.update({
            where: { id: customerId },
            data: { manualDue: { increment: amount } },
          });
        }
        await tx.account.update({
          where: { id: row.accountId },
          data: { balance: { decrement: amount } },
        });
        await tx.transaction.create({
          data: {
            accountId: row.accountId,
            type: TransactionType.DEBIT,
            amount,
            reference: `CUST-PAY-REV-${txId}`,
            description: 'Reversal of customer payment',
          },
        });
      } else if (row.type === CustomerTransactionType.ADVANCE) {
        await tx.customer.update({
          where: { id: customerId },
          data: { totalAdvance: { decrement: amount } },
        });
        await tx.account.update({
          where: { id: row.accountId },
          data: { balance: { decrement: amount } },
        });
        await tx.transaction.create({
          data: {
            accountId: row.accountId,
            type: TransactionType.DEBIT,
            amount,
            reference: `CUST-ADV-REV-${txId}`,
            description: 'Reversal of customer advance',
          },
        });
      } else {
        await tx.customer.update({
          where: { id: customerId },
          data: { manualDue: { decrement: amount } },
        });
        await tx.account.update({
          where: { id: row.accountId },
          data: { balance: { increment: amount } },
        });
        await tx.transaction.create({
          data: {
            accountId: row.accountId,
            type: TransactionType.CREDIT,
            amount,
            reference: `CUST-DUE-REV-${txId}`,
            description: 'Reversal of customer due',
          },
        });
      }

      await tx.customerTransaction.delete({ where: { id: txId } });
      return { ok: true };
    });
  }
}
