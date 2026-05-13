import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReportQueryDto } from '../dto/report-query.dto.js';
import {
  derivePaymentStatus,
  purchaseReportPurchaseWhere,
} from '../helpers/report-query.utils.js';

@Injectable()
export class PurchaseReportService {
  constructor(private readonly prisma: PrismaService) {}

  async purchaseReport(query: ReportQueryDto) {
    const where = purchaseReportPurchaseWhere(query);
    const rawLimit = query.limit ?? 15;
    const limit = Math.min(2000, Math.max(1, Number(rawLimit) || 15));
    const page = Math.max(1, query.page ?? 1);
    const skip = (page - 1) * limit;

    const [
      summary,
      unitsAgg,
      dailyBreakdown,
      topSuppliers,
      totalRows,
      purchaseRows,
    ] = await Promise.all([
      this.prisma.purchase.aggregate({
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

      this.prisma.purchaseItem.aggregate({
        where: { purchase: where },
        _sum: { quantity: true },
      }),

      this.prisma.purchase
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
            { date: string; count: number; amount: number }
          >();
          for (const row of rows) {
            const day = row.createdAt.toISOString().slice(0, 10);
            const existing = map.get(day);
            if (existing) {
              existing.count += row._count.id;
              existing.amount += Number(row._sum.grandTotal ?? 0);
            } else {
              map.set(day, {
                date: day,
                count: row._count.id,
                amount: Number(row._sum.grandTotal ?? 0),
              });
            }
          }
          return [...map.values()];
        }),

      this.prisma.purchase
        .groupBy({
          by: ['supplierId'],
          where: { ...where, supplierId: { not: null } },
          _count: { id: true },
          _sum: { grandTotal: true },
          orderBy: { _sum: { grandTotal: 'desc' } },
          take: 10,
        })
        .then(async (rows) => {
          const ids = rows.map((r) => r.supplierId!).filter(Boolean);
          const suppliers = await this.prisma.supplier.findMany({
            where: { id: { in: ids } },
          });
          const sMap = new Map(suppliers.map((s) => [s.id, s]));
          return rows.map((r) => ({
            supplierId: r.supplierId,
            supplierName: sMap.get(r.supplierId!)?.name ?? 'Unknown',
            totalPurchases: r._count.id,
            totalAmount: Number(r._sum.grandTotal ?? 0),
          }));
        }),

      this.prisma.purchase.count({ where }),

      this.prisma.purchase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          branch: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          items: { select: { quantity: true } },
        },
      }),
    ]);

    const totalGrand = Number(summary._sum.grandTotal ?? 0);
    const totalPaid = Number(summary._sum.paidAmount ?? 0);
    const totalDue = Number(summary._sum.dueAmount ?? 0);
    const totalUnits = Number(unitsAgg._sum.quantity ?? 0);
    const lastPage = Math.max(1, Math.ceil(totalRows / limit));

    const purchases = purchaseRows.map((p) => {
      const paid = Number(p.paidAmount);
      const due = Number(p.dueAmount);
      const grand = Number(p.grandTotal);
      const paymentStatus = derivePaymentStatus(paid, due, grand);
      const totalProducts = p.items.reduce((a, it) => a + it.quantity, 0);
      return {
        id: p.id,
        referenceNo: p.referenceNo,
        supplierName: p.supplier?.name ?? null,
        branch: p.branch,
        items: p.items.map((i) => ({ quantity: i.quantity })),
        totalProducts,
        responsiblePerson: null as string | null,
        grandTotal: grand,
        paidAmount: paid,
        dueAmount: due,
        paymentStatus,
        purchaseDate: p.createdAt.toISOString(),
        date: p.createdAt.toISOString(),
      };
    });

    return {
      totalPurchases: summary._count.id,
      totalAmount: totalGrand,
      totalGrand,
      totalPaid,
      totalDue,
      totalDiscount: Number(summary._sum.discount ?? 0),
      totalTax: Number(summary._sum.tax ?? 0),
      summary: {
        totalPurchases: summary._count.id,
        totalGrand,
        totalPaid,
        totalDue,
        totalUnits,
      },
      dailyBreakdown,
      topSuppliers,
      purchases,
      total: totalRows,
      page,
      lastPage,
      totalPages: lastPage,
      limit,
    };
  }
}
