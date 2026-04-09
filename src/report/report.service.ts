import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReportQueryDto } from './dto/report-query.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  private dateRange(query: ReportQueryDto) {
    const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo + 'T23:59:59.999Z');
    }
    return where;
  }

  private dateFieldRange(field: string, query: ReportQueryDto) {
    const where: Record<string, { gte?: Date; lte?: Date }> = {};
    if (query.dateFrom || query.dateTo) {
      where[field] = {};
      if (query.dateFrom) where[field].gte = new Date(query.dateFrom);
      if (query.dateTo) where[field].lte = new Date(query.dateTo + 'T23:59:59.999Z');
    }
    return where;
  }

  private previousPeriodRange(query: ReportQueryDto) {
    if (!query.dateFrom || !query.dateTo) return null;
    const from = new Date(query.dateFrom);
    const to = new Date(query.dateTo + 'T23:59:59.999Z');
    const diff = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - diff);
    return { gte: prevFrom, lte: prevTo };
  }

  // ─── 1. SALES REPORT ──────────────────────────────────────────

  async salesReport(query: ReportQueryDto) {
    const dateWhere = this.dateRange(query);
    const where: Prisma.SaleWhereInput = {
      ...dateWhere,
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };

    const [summary, dailyBreakdown, topProducts] = await Promise.all([
      this.prisma.sale.aggregate({
        where,
        _count: { id: true },
        _sum: {
          grandTotal: true,
          discount: true,
          tax: true,
        },
      }),

      this.prisma.sale.groupBy({
        by: ['createdAt'],
        where,
        _count: { id: true },
        _sum: { grandTotal: true },
        orderBy: { createdAt: 'asc' },
      }).then((rows) => {
        const map = new Map<string, { date: string; count: number; revenue: number }>();
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

      this.prisma.saleItem.groupBy({
        by: ['storeProductId'],
        where: {
          sale: where,
        },
        _sum: { total: true, quantity: true },
        orderBy: { _sum: { total: 'desc' } },
        take: query.limit ?? 10,
      }).then(async (rows) => {
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
    ]);

    return {
      totalSales: summary._count.id,
      totalRevenue: Number(summary._sum.grandTotal ?? 0),
      totalDiscount: Number(summary._sum.discount ?? 0),
      totalTax: Number(summary._sum.tax ?? 0),
      dailyBreakdown,
      topProducts,
    };
  }

  // ─── 2. PURCHASE REPORT ───────────────────────────────────────

  async purchaseReport(query: ReportQueryDto) {
    const dateWhere = this.dateRange(query);
    const where: Prisma.PurchaseWhereInput = {
      ...dateWhere,
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };

    const [summary, dailyBreakdown, topSuppliers] = await Promise.all([
      this.prisma.purchase.aggregate({
        where,
        _count: { id: true },
        _sum: { grandTotal: true, discount: true, tax: true },
      }),

      this.prisma.purchase.groupBy({
        by: ['createdAt'],
        where,
        _count: { id: true },
        _sum: { grandTotal: true },
        orderBy: { createdAt: 'asc' },
      }).then((rows) => {
        const map = new Map<string, { date: string; count: number; amount: number }>();
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

      this.prisma.purchase.groupBy({
        by: ['supplierId'],
        where: { ...where, supplierId: { not: null } },
        _count: { id: true },
        _sum: { grandTotal: true },
        orderBy: { _sum: { grandTotal: 'desc' } },
        take: query.limit ?? 10,
      }).then(async (rows) => {
        const ids = rows.map((r) => r.supplierId!).filter(Boolean) as number[];
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
    ]);

    return {
      totalPurchases: summary._count.id,
      totalAmount: Number(summary._sum.grandTotal ?? 0),
      totalDiscount: Number(summary._sum.discount ?? 0),
      totalTax: Number(summary._sum.tax ?? 0),
      dailyBreakdown,
      topSuppliers,
    };
  }

  // ─── 3. STOCK REPORT ─────────────────────────────────────────

  async stockReport(query: ReportQueryDto) {
    const where: Prisma.StoreProductWhereInput = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };

    const storeProducts = await this.prisma.storeProduct.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { quantity: 'asc' },
    });

    const grouped = new Map<number, {
      productId: number;
      productName: string;
      sku: string | null;
      totalQty: number;
      totalValue: number;
      branches: { branchId: number; branchName: string; qty: number; sellingPrice: number }[];
    }>();

    for (const sp of storeProducts) {
      const pid = sp.productId;
      const entry = grouped.get(pid) ?? {
        productId: pid,
        productName: sp.product.name,
        sku: sp.product.sku,
        totalQty: 0,
        totalValue: 0,
        branches: [],
      };
      entry.totalQty += sp.quantity;
      entry.totalValue += sp.quantity * Number(sp.sellingPrice);
      entry.branches.push({
        branchId: sp.branchId,
        branchName: sp.branch.name,
        qty: sp.quantity,
        sellingPrice: Number(sp.sellingPrice),
      });
      grouped.set(pid, entry);
    }

    const all = [...grouped.values()];
    const lowStock = storeProducts
      .filter((sp) => sp.quantity <= sp.quantityAlert)
      .map((sp) => ({
        storeProductId: sp.id,
        productName: sp.product.name,
        sku: sp.product.sku,
        branchName: sp.branch.name,
        quantity: sp.quantity,
        quantityAlert: sp.quantityAlert,
        sellingPrice: Number(sp.sellingPrice),
      }));

    return {
      totalProducts: all.length,
      totalQty: all.reduce((s, p) => s + p.totalQty, 0),
      totalValue: all.reduce((s, p) => s + p.totalValue, 0),
      products: all,
      lowStockItems: lowStock,
    };
  }

  // ─── 4. SUPPLIER REPORT ──────────────────────────────────────

  async supplierReport(query: ReportQueryDto) {
    const dateWhere = this.dateRange(query);
    const suppliers = await this.prisma.supplier.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        phone: true,
        company: true,
        totalDue: true,
        purchases: {
          where: {
            ...dateWhere,
            ...(query.branchId ? { branchId: query.branchId } : {}),
          },
          select: { id: true, grandTotal: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      company: s.company,
      totalDue: Number(s.totalDue),
      purchaseCount: s.purchases.length,
      totalPurchaseAmount: s.purchases.reduce((sum, p) => sum + Number(p.grandTotal), 0),
    }));
  }

  // ─── 5. SUPPLIER DUE REPORT ──────────────────────────────────

  async supplierDueReport(query: ReportQueryDto) {
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        totalDue: { gt: 0 },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        company: true,
        totalDue: true,
        purchases: {
          where: {
            dueAmount: { gt: 0 },
            ...(query.branchId ? { branchId: query.branchId } : {}),
          },
          select: {
            id: true,
            referenceNo: true,
            grandTotal: true,
            paidAmount: true,
            dueAmount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { totalDue: 'desc' },
    });

    return suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      company: s.company,
      totalDue: Number(s.totalDue),
      purchases: s.purchases.map((p) => ({
        id: p.id,
        referenceNo: p.referenceNo,
        grandTotal: Number(p.grandTotal),
        paidAmount: Number(p.paidAmount),
        dueAmount: Number(p.dueAmount),
        createdAt: p.createdAt,
      })),
    }));
  }

  // ─── 6. CUSTOMER REPORT ──────────────────────────────────────

  async customerReport(query: ReportQueryDto) {
    const dateWhere = this.dateRange(query);
    const customers = await this.prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        orders: {
          where: dateWhere,
          select: { id: true, totalAmount: true },
        },
        sales: {
          where: {
            ...dateWhere,
            ...(query.branchId ? { branchId: query.branchId } : {}),
          },
          select: { id: true, grandTotal: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      orderCount: c.orders.length,
      totalOrderAmount: c.orders.reduce((s, o) => s + Number(o.totalAmount), 0),
      saleCount: c.sales.length,
      totalSaleAmount: c.sales.reduce((s, sl) => s + Number(sl.grandTotal), 0),
    }));
  }

  // ─── 7. CUSTOMER DUE REPORT ──────────────────────────────────

  async customerDueReport(query: ReportQueryDto) {
    const sales = await this.prisma.sale.findMany({
      where: {
        dueAmount: { gt: 0 },
        customerId: { not: null },
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: { dueAmount: 'desc' },
    });

    const grouped = new Map<number, {
      customerId: number;
      customerName: string;
      phone: string;
      email: string | null;
      totalDue: number;
      sales: { id: number; invoiceNumber: string; grandTotal: number; paidAmount: number; dueAmount: number; createdAt: Date }[];
    }>();

    for (const sale of sales) {
      if (!sale.customer) continue;
      const cid = sale.customer.id;
      const entry = grouped.get(cid) ?? {
        customerId: cid,
        customerName: sale.customer.name,
        phone: sale.customer.phone,
        email: sale.customer.email ?? null,
        totalDue: 0,
        sales: [],
      };
      entry.totalDue += Number(sale.dueAmount);
      entry.sales.push({
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        grandTotal: Number(sale.grandTotal),
        paidAmount: Number(sale.paidAmount),
        dueAmount: Number(sale.dueAmount),
        createdAt: sale.createdAt,
      });
      grouped.set(cid, entry);
    }

    return [...grouped.values()].sort((a, b) => b.totalDue - a.totalDue);
  }

  // ─── 8. PRODUCT REPORT ───────────────────────────────────────

  async productReport(query: ReportQueryDto) {
    const dateWhere = this.dateRange(query);
    const saleWhere: Prisma.SaleWhereInput = {
      ...dateWhere,
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };

    const items = await this.prisma.saleItem.groupBy({
      by: ['storeProductId'],
      where: { sale: saleWhere },
      _sum: { quantity: true, total: true },
      _avg: { unitPrice: true },
      orderBy: { _sum: { total: 'desc' } },
    });

    const ids = items.map((i) => i.storeProductId);
    const storeProducts = await this.prisma.storeProduct.findMany({
      where: { id: { in: ids } },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    const spMap = new Map(storeProducts.map((sp) => [sp.id, sp]));

    return items.map((i) => {
      const sp = spMap.get(i.storeProductId);
      return {
        storeProductId: i.storeProductId,
        productName: sp?.product?.name ?? 'Unknown',
        sku: sp?.product?.sku,
        branchName: sp?.branch?.name,
        totalSoldQty: Number(i._sum.quantity ?? 0),
        totalRevenue: Number(i._sum.total ?? 0),
        averagePrice: Number(i._avg.unitPrice ?? 0),
      };
    });
  }

  // ─── 9. PRODUCT EXPIRY REPORT ────────────────────────────────

  async productExpiryReport(query: ReportQueryDto) {
    const daysThreshold = query.limit ?? 90;
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - daysThreshold);

    const batches = await this.prisma.batch.findMany({
      where: {
        batchDate: { lte: thresholdDate },
        availableQty: { gt: 0 },
        ...(query.branchId
          ? { storeProduct: { branchId: query.branchId } }
          : {}),
      },
      include: {
        storeProduct: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { batchDate: 'asc' },
    });

    return batches.map((b) => ({
      batchId: b.id,
      batchNumber: b.batchNumber,
      batchDate: b.batchDate,
      daysOld: Math.floor((Date.now() - b.batchDate.getTime()) / (1000 * 60 * 60 * 24)),
      availableQty: b.availableQty,
      purchaseCost: Number(b.purchaseCost),
      productName: b.storeProduct.product.name,
      sku: b.storeProduct.product.sku,
      branchName: b.storeProduct.branch.name,
      supplierName: b.supplier?.name ?? null,
    }));
  }

  // ─── 10. PRODUCT QUANTITY REPORT ─────────────────────────────

  async productQuantityReport(query: ReportQueryDto) {
    const storeProducts = await this.prisma.storeProduct.findMany({
      where: query.branchId ? { branchId: query.branchId } : {},
      include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true } },
        productVariant: {
          select: {
            id: true,
            sku: true,
            attributes: {
              include: { attributeValue: { select: { value: true, attribute: { select: { name: true } } } } },
            },
          },
        },
      },
      orderBy: [{ productId: 'asc' }, { branchId: 'asc' }],
    });

    const grouped = new Map<number, {
      productId: number;
      productName: string;
      sku: string | null;
      totalQty: number;
      branches: {
        branchId: number;
        branchName: string;
        quantity: number;
        sellingPrice: number;
        variant: string | null;
      }[];
    }>();

    for (const sp of storeProducts) {
      const pid = sp.productId;
      const entry = grouped.get(pid) ?? {
        productId: pid,
        productName: sp.product.name,
        sku: sp.product.sku,
        totalQty: 0,
        branches: [],
      };

      const variantLabel = sp.productVariant
        ? sp.productVariant.attributes
            .map((a) => `${a.attributeValue.attribute.name}: ${a.attributeValue.value}`)
            .join(', ')
        : null;

      entry.totalQty += sp.quantity;
      entry.branches.push({
        branchId: sp.branchId,
        branchName: sp.branch.name,
        quantity: sp.quantity,
        sellingPrice: Number(sp.sellingPrice),
        variant: variantLabel,
      });
      grouped.set(pid, entry);
    }

    return [...grouped.values()];
  }

  // ─── 11. EXPENSE REPORT ──────────────────────────────────────

  async expenseReport(query: ReportQueryDto) {
    const dateWhere = this.dateFieldRange('date', query);

    const [byCategory, dailyBreakdown, total] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['categoryId'],
        where: dateWhere,
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: 'desc' } },
      }).then(async (rows) => {
        const ids = rows.map((r) => r.categoryId);
        const cats = await this.prisma.expenseCategory.findMany({
          where: { id: { in: ids } },
        });
        const cMap = new Map(cats.map((c) => [c.id, c.name]));
        return rows.map((r) => ({
          categoryId: r.categoryId,
          categoryName: cMap.get(r.categoryId) ?? 'Unknown',
          totalAmount: Number(r._sum.amount ?? 0),
          count: r._count.id,
        }));
      }),

      this.prisma.expense.groupBy({
        by: ['date'],
        where: dateWhere,
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { date: 'asc' },
      }).then((rows) => {
        const map = new Map<string, { date: string; total: number; count: number }>();
        for (const row of rows) {
          const day = row.date.toISOString().slice(0, 10);
          const existing = map.get(day);
          if (existing) {
            existing.total += Number(row._sum.amount ?? 0);
            existing.count += row._count.id;
          } else {
            map.set(day, { date: day, total: Number(row._sum.amount ?? 0), count: row._count.id });
          }
        }
        return [...map.values()];
      }),

      this.prisma.expense.aggregate({
        where: dateWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    return {
      totalExpenses: Number(total._sum.amount ?? 0),
      totalCount: total._count.id,
      byCategory,
      dailyBreakdown,
    };
  }

  // ─── 12. INCOME REPORT ───────────────────────────────────────

  async incomeReport(query: ReportQueryDto) {
    const dateWhere = this.dateFieldRange('date', query);

    const [byCategory, dailyBreakdown, total] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['categoryId'],
        where: dateWhere,
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: 'desc' } },
      }).then(async (rows) => {
        const ids = rows.map((r) => r.categoryId);
        const cats = await this.prisma.incomeCategory.findMany({
          where: { id: { in: ids } },
        });
        const cMap = new Map(cats.map((c) => [c.id, c.name]));
        return rows.map((r) => ({
          categoryId: r.categoryId,
          categoryName: cMap.get(r.categoryId) ?? 'Unknown',
          totalAmount: Number(r._sum.amount ?? 0),
          count: r._count.id,
        }));
      }),

      this.prisma.income.groupBy({
        by: ['date'],
        where: dateWhere,
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { date: 'asc' },
      }).then((rows) => {
        const map = new Map<string, { date: string; total: number; count: number }>();
        for (const row of rows) {
          const day = row.date.toISOString().slice(0, 10);
          const existing = map.get(day);
          if (existing) {
            existing.total += Number(row._sum.amount ?? 0);
            existing.count += row._count.id;
          } else {
            map.set(day, { date: day, total: Number(row._sum.amount ?? 0), count: row._count.id });
          }
        }
        return [...map.values()];
      }),

      this.prisma.income.aggregate({
        where: dateWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    return {
      totalIncome: Number(total._sum.amount ?? 0),
      totalCount: total._count.id,
      byCategory,
      dailyBreakdown,
    };
  }

  // ─── 13. PROFIT & LOSS REPORT ────────────────────────────────

  async profitLossReport(query: ReportQueryDto) {
    const dateWhere = this.dateRange(query);
    const expDateWhere = this.dateFieldRange('date', query);
    const incDateWhere = this.dateFieldRange('date', query);
    const branchFilter = query.branchId ? { branchId: query.branchId } : {};

    const [salesAgg, purchaseAgg, expenseAgg, incomeAgg] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { ...dateWhere, ...branchFilter },
        _sum: { grandTotal: true, discount: true, tax: true },
      }),
      this.prisma.purchase.aggregate({
        where: { ...dateWhere, ...branchFilter },
        _sum: { grandTotal: true },
      }),
      this.prisma.expense.aggregate({
        where: expDateWhere,
        _sum: { amount: true },
      }),
      this.prisma.income.aggregate({
        where: incDateWhere,
        _sum: { amount: true },
      }),
    ]);

    const revenue = Number(salesAgg._sum.grandTotal ?? 0);
    const cogs = Number(purchaseAgg._sum.grandTotal ?? 0);
    const grossProfit = revenue - cogs;
    const operatingExpenses = Number(expenseAgg._sum.amount ?? 0);
    const otherIncome = Number(incomeAgg._sum.amount ?? 0);
    const operatingIncome = grossProfit - operatingExpenses + otherIncome;
    const netProfit = operatingIncome;

    let previousPeriod = null;
    const prevRange = this.previousPeriodRange(query);
    if (prevRange) {
      const [prevSales, prevPurchases, prevExpenses, prevIncomes] = await Promise.all([
        this.prisma.sale.aggregate({
          where: { createdAt: prevRange, ...branchFilter },
          _sum: { grandTotal: true },
        }),
        this.prisma.purchase.aggregate({
          where: { createdAt: prevRange, ...branchFilter },
          _sum: { grandTotal: true },
        }),
        this.prisma.expense.aggregate({
          where: { date: prevRange },
          _sum: { amount: true },
        }),
        this.prisma.income.aggregate({
          where: { date: prevRange },
          _sum: { amount: true },
        }),
      ]);

      const prevRevenue = Number(prevSales._sum.grandTotal ?? 0);
      const prevCogs = Number(prevPurchases._sum.grandTotal ?? 0);
      const prevGross = prevRevenue - prevCogs;
      const prevOpExp = Number(prevExpenses._sum.amount ?? 0);
      const prevOtherInc = Number(prevIncomes._sum.amount ?? 0);
      const prevNetProfit = prevGross - prevOpExp + prevOtherInc;

      previousPeriod = {
        revenue: prevRevenue,
        cogs: prevCogs,
        grossProfit: prevGross,
        operatingExpenses: prevOpExp,
        otherIncome: prevOtherInc,
        netProfit: prevNetProfit,
      };
    }

    return {
      currentPeriod: {
        revenue,
        cogs,
        grossProfit,
        operatingExpenses,
        otherIncome,
        operatingIncome,
        netProfit,
      },
      previousPeriod,
      change: previousPeriod
        ? {
            revenueChange: revenue - previousPeriod.revenue,
            revenueChangePercent: previousPeriod.revenue
              ? ((revenue - previousPeriod.revenue) / previousPeriod.revenue) * 100
              : null,
            netProfitChange: netProfit - previousPeriod.netProfit,
            netProfitChangePercent: previousPeriod.netProfit
              ? ((netProfit - previousPeriod.netProfit) / previousPeriod.netProfit) * 100
              : null,
          }
        : null,
    };
  }
}
