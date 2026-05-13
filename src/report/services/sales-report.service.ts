import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReportQueryDto } from '../dto/report-query.dto.js';
import {
  derivePaymentStatus,
  saleOrderStatusLabel,
  salesReportSaleWhere,
} from '../helpers/report-query.utils.js';

@Injectable()
export class SalesReportService {
  constructor(private readonly prisma: PrismaService) {}

  async salesReport(query: ReportQueryDto) {
    const where = salesReportSaleWhere(query);
    const rawLimit = query.limit ?? 15;
    const limit = Math.min(2000, Math.max(1, Number(rawLimit) || 15));
    const page = Math.max(1, query.page ?? 1);
    const skip = (page - 1) * limit;

    const [
      summary,
      unitsAgg,
      dailyBreakdown,
      topProducts,
      totalRows,
      saleRows,
    ] = await Promise.all([
      this.prisma.sale.aggregate({
        where,
        _count: { id: true },
        _sum: {
          grandTotal: true,
          discount: true,
          tax: true,
          paidAmount: true,
          dueAmount: true,
        },
      }),
      this.prisma.saleItem.aggregate({
        where: { sale: where },
        _sum: { quantity: true },
      }),
      this.prisma.sale
        .groupBy({
          by: ['createdAt'],
          where,
          _count: { id: true },
          _sum: { grandTotal: true },
          orderBy: { createdAt: 'asc' },
        })
        .then((rows) => {
          const map = new Map<
            string,
            { date: string; count: number; revenue: number }
          >();
          for (const row of rows) {
            const day = row.createdAt.toISOString().slice(0, 10);
            const existing = map.get(day);
            if (existing) {
              existing.count += row._count.id;
              existing.revenue += Number(row._sum.grandTotal ?? 0);
            } else {
              map.set(day, {
                date: day,
                count: row._count.id,
                revenue: Number(row._sum.grandTotal ?? 0),
              });
            }
          }
          return [...map.values()];
        }),

      this.prisma.saleItem
        .groupBy({
          by: ['storeProductId'],
          where: {
            sale: where,
          },
          _sum: { total: true, quantity: true },
          orderBy: { _sum: { total: 'desc' } },
          take: 10,
        })
        .then(async (rows) => {
          const ids = rows.map((r) => r.storeProductId);
          const products = await this.prisma.storeProduct.findMany({
            where: { id: { in: ids } },
            include: { product: { select: { name: true, sku: true } } },
          });
          const pMap = new Map(products.map((p) => [p.id, p]));
          return rows.map((r) => ({
            storeProductId: r.storeProductId,
            productName: pMap.get(r.storeProductId)?.product?.name ?? 'Unknown',
            sku: pMap.get(r.storeProductId)?.product?.sku,
            totalRevenue: Number(r._sum.total ?? 0),
            totalQtySold: Number(r._sum.quantity ?? 0),
          }));
        }),

      this.prisma.sale.count({ where }),

      this.prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          branch: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true, phone: true } },
          items: { select: { quantity: true } },
        },
      }),
    ]);

    const totalRevenue = Number(summary._sum.grandTotal ?? 0);
    const totalPaid = Number(summary._sum.paidAmount ?? 0);
    const totalDue = Number(summary._sum.dueAmount ?? 0);
    const totalUnitsSold = Number(unitsAgg._sum.quantity ?? 0);
    const lastPage = Math.max(1, Math.ceil(totalRows / limit));

    const sales = saleRows.map((s) => {
      const paid = Number(s.paidAmount);
      const due = Number(s.dueAmount);
      const grand = Number(s.grandTotal);
      const paymentStatus = derivePaymentStatus(paid, due, grand);
      const change = Math.max(0, paid - grand);
      const unitsOnSale = s.items.reduce((a, it) => a + it.quantity, 0);
      return {
        id: s.id,
        invoiceNumber: s.invoiceNumber,
        invoiceNo: s.invoiceNumber,
        invoice: s.invoiceNumber,
        grandTotal: grand,
        paidAmount: paid,
        dueAmount: due,
        change,
        total: grand,
        discount: Number(s.discount),
        tax: Number(s.tax),
        branch: s.branch,
        orderStatus: saleOrderStatusLabel(s.status),
        paymentStatus,
        createdAt: s.createdAt.toISOString(),
        date: s.createdAt.toISOString(),
        customer: s.customer
          ? { id: s.customer.id, name: s.customer.name, phone: s.customer.phone }
          : null,
        items: s.items.map((i) => ({ quantity: i.quantity })),
        unitsSold: unitsOnSale,
      };
    });

    return {
      totalSales: summary._count.id,
      totalRevenue,
      revenue: totalRevenue,
      totalDiscount: Number(summary._sum.discount ?? 0),
      totalTax: Number(summary._sum.tax ?? 0),
      summary: {
        totalUnitsSold,
        totalSalesAmount: totalRevenue,
        totalPaid,
        totalDue,
      },
      dailyBreakdown,
      topProducts,
      sales,
      total: totalRows,
      page,
      lastPage,
      totalPages: lastPage,
      limit,
    };
  }
}
