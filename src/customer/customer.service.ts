import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { QuickTransactionDto } from './dto/quick-transaction.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 16, search, sort, order = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
      ];
    }

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
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(data, total, page, limit);
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
    return this.prisma.customer.create({ data: dto });
  }

  async update(id: number, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.prisma.customer.delete({ where: { id } });
  }

  async getDueCustomers() {
    const customers = await this.prisma.customer.findMany({
      where: {
        OR: [
          { totalAdvance: { gt: 0 } },
          { sales: { some: { dueAmount: { gt: 0 } } } },
        ],
      },
      include: {
        _count: { select: { orders: true, sales: true } },
        sales: {
          where: { dueAmount: { gt: 0 } },
          select: { id: true, invoiceNumber: true, grandTotal: true, paidAmount: true, dueAmount: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return customers;
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
      _sum: { grandTotal: true, paidAmount: true },
    });

    const totalAdvance = customer.totalAdvance;
    const totalPurchase = salesAgg._sum.grandTotal ?? new Prisma.Decimal(0);
    const totalPaid = salesAgg._sum.paidAmount ?? new Prisma.Decimal(0);
    const totalDue = totalPurchase.sub(totalPaid).sub(totalAdvance);

    return {
      totalAdvance,
      totalPurchase,
      totalPaid,
      totalDue: totalDue.greaterThan(0) ? totalDue : new Prisma.Decimal(0),
    };
  }
}
