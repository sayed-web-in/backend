import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { paginate } from '../../common/pagination.dto.js';
import { SaleQueryDto } from '../dto/sale-query.dto.js';
import type { PayLaterQueryDto } from '../dto/pay-later-query.dto.js';
import { saleWhereFromDto } from '../helpers/sale-query.filters.js';
import { priorReturnedForSaleLine } from '../helpers/sale-return.utils.js';

@Injectable()
export class SaleQueryService {
  constructor(private readonly prisma: PrismaService) {}
  async findAll(query: SaleQueryDto) {
    const { page = 1, limit = 16, sort, order = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where = saleWhereFromDto(query);

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
    const where = saleWhereFromDto(query);
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
}