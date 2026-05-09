import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReportQueryDto } from './dto/report-query.dto.js';
import { Prisma, SaleStatus } from '@prisma/client';
import { bdDayEndUtc, bdDayStartUtc } from '../common/bd-time.js';

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  private dateRange(query: ReportQueryDto) {
    const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = bdDayStartUtc(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = bdDayEndUtc(query.dateTo);
    }
    return where;
  }

  private dateFieldRange(field: string, query: ReportQueryDto) {
    const where: Record<string, { gte?: Date; lte?: Date }> = {};
    if (query.dateFrom || query.dateTo) {
      where[field] = {};
      if (query.dateFrom) where[field].gte = bdDayStartUtc(query.dateFrom);
      if (query.dateTo) where[field].lte = bdDayEndUtc(query.dateTo);
    }
    return where;
  }

  private previousPeriodRange(query: ReportQueryDto) {
    if (!query.dateFrom || !query.dateTo) return null;
    const from = bdDayStartUtc(query.dateFrom);
    const to = bdDayEndUtc(query.dateTo);
    const diff = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - diff);
    return { gte: prevFrom, lte: prevTo };
  }

  /**
   * Estimated unit cost per store line (avg batch purchaseCost, then avg purchase unitCost).
   * Matches product-transaction / POS cost lines when batches exist.
   */
  private async avgUnitCostByStoreProduct(
    storeProductIds: number[],
  ): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (storeProductIds.length === 0) return map;

    const batchAvgs = await this.prisma.batch.groupBy({
      by: ['storeProductId'],
      where: { storeProductId: { in: storeProductIds } },
      _avg: { purchaseCost: true },
    });
    for (const row of batchAvgs) {
      map.set(row.storeProductId, Number(row._avg.purchaseCost ?? 0));
    }

    const missing = storeProductIds.filter((id) => (map.get(id) ?? 0) <= 0);
    if (missing.length === 0) return map;

    const purchaseAvgs = await this.prisma.purchaseItem.groupBy({
      by: ['storeProductId'],
      where: { storeProductId: { in: missing } },
      _avg: { unitCost: true },
    });
    for (const row of purchaseAvgs) {
      const v = Number(row._avg.unitCost ?? 0);
      if (v > 0) map.set(row.storeProductId, v);
    }
    return map;
  }

  /** COGS for the period: Σ sale line qty × unit cost (not “purchases in period”). */
  private async cogsFromSoldItemsForSaleWhere(
    saleWhere: Prisma.SaleWhereInput,
  ): Promise<number> {
    const items = await this.prisma.saleItem.findMany({
      where: { sale: saleWhere },
      select: { storeProductId: true, quantity: true },
    });
    if (items.length === 0) return 0;
    const storeIds = [...new Set(items.map((i) => i.storeProductId))];
    const costMap = await this.avgUnitCostByStoreProduct(storeIds);
    let sum = 0;
    for (const it of items) {
      sum += it.quantity * (costMap.get(it.storeProductId) ?? 0);
    }
    return sum;
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
          take: query.limit ?? 10,
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
          take: query.limit ?? 10,
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

    const grouped = new Map<
      number,
      {
        productId: number;
        productName: string;
        sku: string | null;
        totalQty: number;
        totalValue: number;
        branches: {
          branchId: number;
          branchName: string;
          qty: number;
          sellingPrice: number;
        }[];
      }
    >();

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
      totalPurchaseAmount: s.purchases.reduce(
        (sum, p) => sum + Number(p.grandTotal),
        0,
      ),
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
        customer: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
      orderBy: { dueAmount: 'desc' },
    });

    const grouped = new Map<
      number,
      {
        customerId: number;
        customerName: string;
        phone: string;
        email: string | null;
        totalDue: number;
        sales: {
          id: number;
          invoiceNumber: string;
          grandTotal: number;
          paidAmount: number;
          dueAmount: number;
          createdAt: Date;
        }[];
      }
    >();

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
      daysOld: Math.floor(
        (Date.now() - b.batchDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
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
              include: {
                attributeValue: {
                  select: {
                    value: true,
                    attribute: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ productId: 'asc' }, { branchId: 'asc' }],
    });

    const grouped = new Map<
      number,
      {
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
      }
    >();

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
            .map(
              (a) =>
                `${a.attributeValue.attribute.name}: ${a.attributeValue.value}`,
            )
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
      this.prisma.expense
        .groupBy({
          by: ['categoryId'],
          where: dateWhere,
          _sum: { amount: true },
          _count: { id: true },
          orderBy: { _sum: { amount: 'desc' } },
        })
        .then(async (rows) => {
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

      this.prisma.expense
        .groupBy({
          by: ['date'],
          where: dateWhere,
          _sum: { amount: true },
          _count: { id: true },
          orderBy: { date: 'asc' },
        })
        .then((rows) => {
          const map = new Map<
            string,
            { date: string; total: number; count: number }
          >();
          for (const row of rows) {
            const day = row.date.toISOString().slice(0, 10);
            const existing = map.get(day);
            if (existing) {
              existing.total += Number(row._sum.amount ?? 0);
              existing.count += row._count.id;
            } else {
              map.set(day, {
                date: day,
                total: Number(row._sum.amount ?? 0),
                count: row._count.id,
              });
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
      this.prisma.income
        .groupBy({
          by: ['categoryId'],
          where: dateWhere,
          _sum: { amount: true },
          _count: { id: true },
          orderBy: { _sum: { amount: 'desc' } },
        })
        .then(async (rows) => {
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

      this.prisma.income
        .groupBy({
          by: ['date'],
          where: dateWhere,
          _sum: { amount: true },
          _count: { id: true },
          orderBy: { date: 'asc' },
        })
        .then((rows) => {
          const map = new Map<
            string,
            { date: string; total: number; count: number }
          >();
          for (const row of rows) {
            const day = row.date.toISOString().slice(0, 10);
            const existing = map.get(day);
            if (existing) {
              existing.total += Number(row._sum.amount ?? 0);
              existing.count += row._count.id;
            } else {
              map.set(day, {
                date: day,
                total: Number(row._sum.amount ?? 0),
                count: row._count.id,
              });
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

  private monthBounds(year: number, monthIndex: number) {
    return {
      gte: new Date(year, monthIndex, 1, 0, 0, 0, 0),
      lte: new Date(year, monthIndex + 1, 0, 23, 59, 59, 999),
    };
  }

  /** Monthly P&L matrix (same shape as seller-admin profit-loss report). */
  private async profitLossYearlyMatrix(year: number, branchId?: number) {
    const branchWhere =
      branchId != null && Number.isFinite(branchId)
        ? { branchId: Math.floor(branchId) }
        : {};
    const expenseBranchWhere = branchWhere;

    const monthLabels = Array.from({ length: 12 }, (_, m) =>
      new Date(year, m, 1).toLocaleString('en-US', { month: 'short' }),
    );

    const z = () => Array.from({ length: 12 }, () => 0);
    const posSales = z();
    const ecommerceSales = z();
    const wholesaleSales = z();
    const quickSellSales = z();
    const totalSales = z();
    const serviceIncome = z();
    const othersIncome = z();
    const returnGain = z();
    const totalIncome = z();
    const grossProfit = z();
    const cogs = z();
    const salesReturn = z();
    const salaryWages = z();
    const otherOperatingExpenses = z();
    const totalExpense = z();
    const netProfit = z();

    const [expenseCategories, incomeCategories] = await Promise.all([
      this.prisma.expenseCategory.findMany({ select: { id: true, name: true } }),
      this.prisma.incomeCategory.findMany({ select: { id: true, name: true } }),
    ]);
    const salaryCatIds = expenseCategories
      .filter((c) => /salary|wage|payroll|stipend/i.test(c.name))
      .map((c) => c.id);
    const serviceIncomeCatIds = incomeCategories
      .filter((c) => /service/i.test(c.name))
      .map((c) => c.id);

    const yearGte = new Date(year, 0, 1, 0, 0, 0, 0);
    const yearLte = new Date(year, 11, 31, 23, 59, 59, 999);
    const yearSaleItems = await this.prisma.saleItem.findMany({
      where: {
        sale: {
          createdAt: { gte: yearGte, lte: yearLte },
          status: { not: SaleStatus.RETURNED },
          ...branchWhere,
        },
      },
      select: {
        quantity: true,
        storeProductId: true,
        sale: { select: { createdAt: true } },
      },
    });
    const cogsMonthly = Array.from({ length: 12 }, () => 0);
    if (yearSaleItems.length > 0) {
      const storeIds = [...new Set(yearSaleItems.map((i) => i.storeProductId))];
      const costMap = await this.avgUnitCostByStoreProduct(storeIds);
      for (const it of yearSaleItems) {
        const m = it.sale.createdAt.getMonth();
        cogsMonthly[m] += it.quantity * (costMap.get(it.storeProductId) ?? 0);
      }
    }

    for (let m = 0; m < 12; m++) {
      const { gte, lte } = this.monthBounds(year, m);
      const saleWhere = {
        createdAt: { gte, lte },
        ...branchWhere,
        status: { not: SaleStatus.RETURNED },
      };
      const dateInMonth = { gte, lte };
      const saleReturnWhere: Prisma.SaleReturnWhereInput = {
        createdAt: dateInMonth,
        ...(branchId != null && Number.isFinite(branchId)
          ? { sale: { branchId: Math.floor(branchId) } }
          : {}),
      };

      const [posSaleAgg, ecomSaleAgg, saleReturnAgg] = await Promise.all([
        this.prisma.sale.aggregate({
          where: { ...saleWhere, orderId: null },
          _sum: { grandTotal: true, servicesTotal: true },
        }),
        this.prisma.sale.aggregate({
          where: { ...saleWhere, orderId: { not: null } },
          _sum: { grandTotal: true, servicesTotal: true },
        }),
        this.prisma.saleReturn.aggregate({
          where: saleReturnWhere,
          _sum: { totalAmount: true },
        }),
      ]);

      let salSum = 0;
      let otherExpSum = 0;
      if (salaryCatIds.length) {
        const [a, b] = await Promise.all([
          this.prisma.expense.aggregate({
            where: {
              date: dateInMonth,
              status: 'active',
              ...expenseBranchWhere,
              categoryId: { in: salaryCatIds },
            },
            _sum: { amount: true },
          }),
          this.prisma.expense.aggregate({
            where: {
              date: dateInMonth,
              status: 'active',
              ...expenseBranchWhere,
              categoryId: { notIn: salaryCatIds },
            },
            _sum: { amount: true },
          }),
        ]);
        salSum = Number(a._sum.amount ?? 0);
        otherExpSum = Number(b._sum.amount ?? 0);
      } else {
        const allExp = await this.prisma.expense.aggregate({
          where: {
            date: dateInMonth,
            status: 'active',
            ...expenseBranchWhere,
          },
          _sum: { amount: true },
        });
        otherExpSum = Number(allExp._sum.amount ?? 0);
      }

      let svcInc = 0;
      let othInc = 0;
      if (serviceIncomeCatIds.length) {
        const [a, b] = await Promise.all([
          this.prisma.income.aggregate({
            where: {
              date: dateInMonth,
              status: 'active',
              ...branchWhere,
              categoryId: { in: serviceIncomeCatIds },
            },
            _sum: { amount: true },
          }),
          this.prisma.income.aggregate({
            where: {
              date: dateInMonth,
              status: 'active',
              ...branchWhere,
              categoryId: { notIn: serviceIncomeCatIds },
            },
            _sum: { amount: true },
          }),
        ]);
        svcInc = Number(a._sum.amount ?? 0);
        othInc = Number(b._sum.amount ?? 0);
      } else {
        const allInc = await this.prisma.income.aggregate({
          where: {
            date: dateInMonth,
            status: 'active',
            ...branchWhere,
          },
          _sum: { amount: true },
        });
        othInc = Number(allInc._sum.amount ?? 0);
      }

      const posGrand = Number(posSaleAgg._sum?.grandTotal ?? 0);
      const posSvc = Number(posSaleAgg._sum?.servicesTotal ?? 0);
      const ecomGrand = Number(ecomSaleAgg._sum?.grandTotal ?? 0);
      const ecomSvc = Number(ecomSaleAgg._sum?.servicesTotal ?? 0);
      posSales[m] = posGrand - posSvc;
      ecommerceSales[m] = ecomGrand - ecomSvc;
      const saleSvcMonth = posSvc + ecomSvc;
      wholesaleSales[m] = 0;
      quickSellSales[m] = 0;
      totalSales[m] =
        posSales[m] + ecommerceSales[m] + wholesaleSales[m] + quickSellSales[m];
      serviceIncome[m] = svcInc + saleSvcMonth;
      othersIncome[m] = othInc;
      returnGain[m] = 0;
      totalIncome[m] =
        totalSales[m] + serviceIncome[m] + othersIncome[m];
      cogs[m] = cogsMonthly[m];
      salesReturn[m] = Number(saleReturnAgg._sum?.totalAmount ?? 0);
      salaryWages[m] = salSum;
      otherOperatingExpenses[m] = otherExpSum;
      totalExpense[m] =
        cogs[m] +
        salesReturn[m] +
        salaryWages[m] +
        otherOperatingExpenses[m];
      grossProfit[m] = totalIncome[m] - cogs[m];
      netProfit[m] = totalIncome[m] - totalExpense[m];
    }

    return {
      year,
      branchId: branchId ?? null,
      monthLabels,
      data: {
        posSales,
        ecommerceSales,
        wholesaleSales,
        quickSellSales,
        totalSales,
        serviceIncome,
        othersIncome,
        returnGain,
        totalIncome,
        grossProfit,
        cogs,
        salesReturn,
        salaryWages,
        otherOperatingExpenses,
        totalExpense,
        netProfit,
      },
    };
  }

  async profitLossReport(query: ReportQueryDto) {
    if (query.year != null) {
      const y = Math.floor(Number(query.year));
      if (!Number.isNaN(y) && y >= 2000 && y <= 2100) {
        return this.profitLossYearlyMatrix(y, query.branchId);
      }
    }

    const dateWhere = this.dateRange(query);
    const expDateWhere = this.dateFieldRange('date', query);
    const incDateWhere = this.dateFieldRange('date', query);
    const branchFilter = query.branchId ? { branchId: query.branchId } : {};
    const expensePnlWhere: Prisma.ExpenseWhereInput = {
      ...expDateWhere,
      status: 'active',
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
    const incomePnlWhere: Prisma.IncomeWhereInput = {
      ...incDateWhere,
      status: 'active',
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
    const saleForPnlWhere: Prisma.SaleWhereInput = {
      ...dateWhere,
      ...branchFilter,
      status: { not: SaleStatus.RETURNED },
    };

    const [salesAgg, expenseAgg, incomeAgg, cogs] = await Promise.all([
      this.prisma.sale.aggregate({
        where: saleForPnlWhere,
        _sum: { grandTotal: true, discount: true, tax: true },
      }),
      this.prisma.expense.aggregate({
        where: expensePnlWhere,
        _sum: { amount: true },
      }),
      this.prisma.income.aggregate({
        where: incomePnlWhere,
        _sum: { amount: true },
      }),
      this.cogsFromSoldItemsForSaleWhere(saleForPnlWhere),
    ]);

    const revenue = Number(salesAgg._sum.grandTotal ?? 0);
    const grossProfit = revenue - cogs;
    const operatingExpenses = Number(expenseAgg._sum.amount ?? 0);
    const otherIncome = Number(incomeAgg._sum.amount ?? 0);
    const operatingIncome = grossProfit - operatingExpenses + otherIncome;
    const netProfit = operatingIncome;

    type PreviousPeriodSummary = {
      revenue: number;
      cogs: number;
      grossProfit: number;
      operatingExpenses: number;
      otherIncome: number;
      netProfit: number;
    };
    let previousPeriod: PreviousPeriodSummary | null = null;
    const prevRange = this.previousPeriodRange(query);
    if (prevRange) {
      const [prevSales, prevExpenses, prevIncomes, prevCogs] =
        await Promise.all([
          this.prisma.sale.aggregate({
            where: {
              createdAt: prevRange,
              ...branchFilter,
              status: { not: SaleStatus.RETURNED },
            },
            _sum: { grandTotal: true },
          }),
          this.prisma.expense.aggregate({
            where: {
              date: prevRange,
              status: 'active',
              ...(query.branchId ? { branchId: query.branchId } : {}),
            },
            _sum: { amount: true },
          }),
          this.prisma.income.aggregate({
            where: {
              date: prevRange,
              status: 'active',
              ...(query.branchId ? { branchId: query.branchId } : {}),
            },
            _sum: { amount: true },
          }),
          this.cogsFromSoldItemsForSaleWhere({
            createdAt: prevRange,
            ...branchFilter,
            status: { not: SaleStatus.RETURNED },
          }),
        ]);

      const prevRevenue = Number(prevSales._sum.grandTotal ?? 0);
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

    const prevSummary = previousPeriod;

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
      previousPeriod: prevSummary,
      change: prevSummary
        ? {
            revenueChange: revenue - prevSummary.revenue,
            revenueChangePercent: prevSummary.revenue
              ? ((revenue - prevSummary.revenue) / prevSummary.revenue) * 100
              : null,
            netProfitChange: netProfit - prevSummary.netProfit,
            netProfitChangePercent: prevSummary.netProfit
              ? ((netProfit - prevSummary.netProfit) / prevSummary.netProfit) *
                100
              : null,
          }
        : null,
    };
  }
}
