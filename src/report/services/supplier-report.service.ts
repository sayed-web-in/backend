import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReportQueryDto } from '../dto/report-query.dto.js';
import {
  financeLinePagination,
  purchaseReportPurchaseWhere,
} from '../helpers/report-query.utils.js';

@Injectable()
export class SupplierReportService {
  constructor(private readonly prisma: PrismaService) {}

  async supplierReport(query: ReportQueryDto) {
    const purchaseWhere = purchaseReportPurchaseWhere(query);

    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        phone: true,
        company: true,
        totalDue: true,
        purchases: {
          where: purchaseWhere,
          select: {
            id: true,
            grandTotal: true,
            paidAmount: true,
            dueAmount: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const rows = suppliers.map((s) => {
      let totalPurchaseAmount = 0;
      let totalPaidAmount = 0;
      let totalDueAmount = 0;
      for (const p of s.purchases) {
        totalPurchaseAmount += Number(p.grandTotal);
        totalPaidAmount += Number(p.paidAmount);
        totalDueAmount += Number(p.dueAmount);
      }
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        company: s.company,
        totalDue: Number(s.totalDue),
        purchaseCount: s.purchases.length,
        totalPurchaseAmount,
        totalPaidAmount,
        totalDueAmount,
      };
    });

    const search = query.search?.trim().toLowerCase();
    let filtered = search
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(search) ||
            (r.phone?.toLowerCase().includes(search) ?? false) ||
            (r.company?.toLowerCase().includes(search) ?? false),
        )
      : rows;

    filtered = [...filtered].sort(
      (a, b) => b.totalPurchaseAmount - a.totalPurchaseAmount,
    );

    const { limit, page, skip } = financeLinePagination(query);
    const totalRows = filtered.length;
    const lastPage = Math.max(1, Math.ceil(totalRows / limit));
    const pageItems = filtered.slice(skip, skip + limit);

    const purchaseLines = filtered.reduce((s, r) => s + r.purchaseCount, 0);
    const summaryPurchase = filtered.reduce((s, r) => s + r.totalPurchaseAmount, 0);
    const summaryPaid = filtered.reduce((s, r) => s + r.totalPaidAmount, 0);

    const suppliersLegacy = pageItems.map((r) => ({
      supplier: r.name,
      company: r.company ?? '—',
      purchases: r.purchaseCount,
      amount: r.totalPurchaseAmount,
      paid: r.totalPaidAmount,
    }));

    return {
      summary: {
        supplierCount: totalRows,
        purchaseLines,
        totalPurchaseAmount: summaryPurchase,
        totalPaidAmount: summaryPaid,
      },
      totalSuppliers: totalRows,
      totalPurchases: purchaseLines,
      totalPaid: summaryPaid,
      suppliers: suppliersLegacy,
      items: pageItems,
      total: totalRows,
      page,
      lastPage,
      totalPages: lastPage,
      limit,
    };
  }
}
