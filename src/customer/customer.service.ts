import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { QuickTransactionDto } from './dto/quick-transaction.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';

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
      select: { totalAdvance: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const salesAgg = await this.prisma.sale.aggregate({
      where: { customerId: id },
      _sum: { grandTotal: true, paidAmount: true, dueAmount: true },
    });

    const totalAdvance = customer.totalAdvance;
    const totalPurchase = salesAgg._sum.grandTotal ?? new Prisma.Decimal(0);
    const totalPaid = salesAgg._sum.paidAmount ?? new Prisma.Decimal(0);
    const totalDue = salesAgg._sum.dueAmount ?? new Prisma.Decimal(0);

    return {
      totalAdvance,
      totalPurchase,
      totalPaid,
      totalDue: totalDue.greaterThan(0) ? totalDue : new Prisma.Decimal(0),
    };
  }
}
