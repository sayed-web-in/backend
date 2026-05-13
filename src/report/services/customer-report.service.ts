import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReportQueryDto } from '../dto/report-query.dto.js';
import {
  financeLinePagination,
  salesReportDateWhere,
  salesReportSaleWhere,
} from '../helpers/report-query.utils.js';

@Injectable()
export class CustomerReportService {
  constructor(private readonly prisma: PrismaService) {}

  async customerReport(query: ReportQueryDto) {
    const saleWhere = salesReportSaleWhere(query);
    const orderWhere: Prisma.OrderWhereInput = {
      ...salesReportDateWhere(query),
    };

    const search = query.search?.trim();
    const customers = await this.prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { phone: { contains: search } },
            ],
          }
        : {},
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        orders: {
          where: orderWhere,
          select: { id: true, totalAmount: true },
        },
        sales: {
          where: saleWhere,
          select: { id: true, grandTotal: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const rows = customers.map((c) => {
      const totalOrderAmount = c.orders.reduce((s, o) => s + Number(o.totalAmount), 0);
      const totalSaleAmount = c.sales.reduce((s, sl) => s + Number(sl.grandTotal), 0);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email ?? null,
        orderCount: c.orders.length,
        totalOrderAmount,
        saleCount: c.sales.length,
        totalSaleAmount,
        activityScore: totalOrderAmount + totalSaleAmount,
      };
    });

    const sorted = [...rows].sort((a, b) => b.activityScore - a.activityScore);

    const { limit, page, skip } = financeLinePagination(query);
    const totalRows = sorted.length;
    const lastPage = Math.max(1, Math.ceil(totalRows / limit));
    const pageItems = sorted.slice(skip, skip + limit);

    const totalOrderAmountAll = sorted.reduce((s, r) => s + r.totalOrderAmount, 0);
    const totalSaleAmountAll = sorted.reduce((s, r) => s + r.totalSaleAmount, 0);

    const customersLegacy = pageItems.map((r) => ({
      customer: r.name,
      phone: r.phone,
      orders: r.orderCount,
      sales: r.saleCount,
      revenue: r.totalSaleAmount + r.totalOrderAmount,
    }));

    return {
      summary: {
        customerCount: totalRows,
        totalOrders: sorted.reduce((s, r) => s + r.orderCount, 0),
        totalSales: sorted.reduce((s, r) => s + r.saleCount, 0),
        totalOrderAmount: totalOrderAmountAll,
        totalSaleAmount: totalSaleAmountAll,
        totalRevenue: totalOrderAmountAll + totalSaleAmountAll,
      },
      totalCustomers: totalRows,
      totalSales: sorted.reduce((s, r) => s + r.saleCount, 0),
      totalRevenue: totalOrderAmountAll + totalSaleAmountAll,
      customers: customersLegacy,
      items: pageItems,
      total: totalRows,
      page,
      lastPage,
      totalPages: lastPage,
      limit,
    };
  }
}
