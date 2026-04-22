import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { QuickPaymentDto } from './dto/quick-payment.dto.js';
import { paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';
import type { SupplierQueryDto } from './dto/supplier-query.dto.js';

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: SupplierQueryDto) {
    const { page = 1, limit = 16, search, sort, order = 'desc', isActive } =
      query;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { company: { contains: search } },
        { phone: { contains: search } },
      ];
    }
    if (typeof isActive === 'boolean') where.isActive = isActive;

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          _count: { select: { purchases: true, batches: true } },
        },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getSummary(query: SupplierQueryDto) {
    const where: Prisma.SupplierWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search } },
        { company: { contains: query.search } },
        { phone: { contains: query.search } },
      ];
    }
    if (typeof query.isActive === 'boolean') where.isActive = query.isActive;

    const [total, active, dueAgg] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.count({ where: { AND: [where, { isActive: true }] } }),
      this.prisma.supplier.aggregate({ where, _sum: { totalDue: true } }),
    ]);

    return {
      total,
      active,
      totalDue: Number(dueAgg._sum.totalDue ?? 0),
    };
  }

  async findOne(id: number) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { branch: true },
        },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async create(dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: dto });
  }

  async update(id: number, dto: UpdateSupplierDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.prisma.supplier.delete({ where: { id } });
  }

  async addQuickPayment(supplierId: number, dto: QuickPaymentDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const amount = new Prisma.Decimal(dto.amount);

    return this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id: supplierId },
        data: { totalDue: { decrement: amount } },
      });

      if (dto.paymentAccountId) {
        await tx.transaction.create({
          data: {
            accountId: dto.paymentAccountId,
            type: 'DEBIT',
            amount,
            reference: `SUP-PAY-${supplierId}-${Date.now()}`,
            description:
              dto.note ?? `Supplier payment - ${supplier.name}`,
          },
        });

        await tx.account.update({
          where: { id: dto.paymentAccountId },
          data: { balance: { decrement: amount } },
        });
      }

      return tx.supplier.findUnique({ where: { id: supplierId } });
    });
  }
}
