import { Injectable } from '@nestjs/common';
import { Prisma, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReportQueryDto } from '../dto/report-query.dto.js';
import {
  dateFieldRange,
  dateRange,
  previousPeriodRange,
} from '../helpers/report-query.utils.js';
import {
  legacyPosServiceIncomeGap,
  sellerStyleExpenseWhere,
  sellerStylePnlRevenue,
} from '../../common/seller-style-pnl.js';
import {
  completedSaleReturnWhere,
  sellerStyleReturnGainTotal,
} from '../../common/sale-return-seller.js';
import { ReportCostingService } from '../report-costing.service.js';

@Injectable()
export class ProfitLossReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: ReportCostingService,
  ) {}

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
        costPrice: true,
        sale: { select: { createdAt: true } },
      },
    });
    const cogsMonthly = Array.from({ length: 12 }, () => 0);
    if (yearSaleItems.length > 0) {
      const needFb = yearSaleItems.filter(
        (i) => !i.costPrice || Number(i.costPrice) <= 0,
      );
      const storeIds = [...new Set(needFb.map((i) => i.storeProductId))];
      const spRows =
        storeIds.length > 0
          ? await this.prisma.storeProduct.findMany({
              where: { id: { in: storeIds } },
              select: { id: true, averageCost: true },
            })
          : [];
      const spAvgMap = new Map(
        spRows.map((r) => [r.id, Number(r.averageCost)]),
      );
      const stillNeedBatch = storeIds.filter(
        (id) => (spAvgMap.get(id) ?? 0) <= 0,
      );
      const costMap =
        stillNeedBatch.length > 0
          ? await this.costing.avgUnitCostByStoreProduct(stillNeedBatch)
          : new Map<number, number>();
      for (const it of yearSaleItems) {
        const m = it.sale.createdAt.getMonth();
        const uc =
          it.costPrice != null && Number(it.costPrice) > 0
            ? Number(it.costPrice)
            : (spAvgMap.get(it.storeProductId) ?? 0) > 0
              ? (spAvgMap.get(it.storeProductId) ?? 0)
              : (costMap.get(it.storeProductId) ?? 0);
        cogsMonthly[m] += it.quantity * uc;
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
      const saleReturnWhere: Prisma.SaleReturnWhereInput =
        completedSaleReturnWhere({
          createdAt: dateInMonth,
          ...(branchId != null && Number.isFinite(branchId)
            ? { sale: { branchId: Math.floor(branchId) } }
            : {}),
        });

      const [posSaleAgg, ecomSaleAgg, saleReturnRefundAgg, monthReturnGain] =
        await Promise.all([
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
            _sum: { refundAmount: true },
          }),
          sellerStyleReturnGainTotal(this.prisma, saleReturnWhere),
        ]);

      let salSum = 0;
      let otherExpSum = 0;
      const monthExpenseBase = sellerStyleExpenseWhere({
        date: dateInMonth,
        ...expenseBranchWhere,
      });
      if (salaryCatIds.length) {
        const [a, b] = await Promise.all([
          this.prisma.expense.aggregate({
            where: {
              ...monthExpenseBase,
              categoryId: { in: salaryCatIds },
            },
            _sum: { amount: true },
          }),
          this.prisma.expense.aggregate({
            where: {
              ...monthExpenseBase,
              categoryId: { notIn: salaryCatIds },
            },
            _sum: { amount: true },
          }),
        ]);
        salSum = Number(a._sum.amount ?? 0);
        otherExpSum = Number(b._sum.amount ?? 0);
      } else {
        const allExp = await this.prisma.expense.aggregate({
          where: monthExpenseBase,
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
      wholesaleSales[m] = 0;
      quickSellSales[m] = 0;
      const legacySvc = await legacyPosServiceIncomeGap(this.prisma, saleWhere);
      serviceIncome[m] = svcInc + legacySvc;
      othersIncome[m] = othInc;
      salesReturn[m] = Number(saleReturnRefundAgg._sum?.refundAmount ?? 0);
      totalSales[m] =
        posSales[m] +
        ecommerceSales[m] +
        wholesaleSales[m] +
        quickSellSales[m] -
        salesReturn[m];
      returnGain[m] = monthReturnGain;
      totalIncome[m] =
        totalSales[m] + serviceIncome[m] + othersIncome[m] + returnGain[m];
      cogs[m] = cogsMonthly[m];
      salaryWages[m] = salSum;
      otherOperatingExpenses[m] = otherExpSum;
      totalExpense[m] =
        cogs[m] + salaryWages[m] + otherOperatingExpenses[m];
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

    const dateWhere = dateRange(query);
    const expDateWhere = dateFieldRange('date', query);
    const incDateWhere = dateFieldRange('date', query);
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

    const saleReturnWhere: Prisma.SaleReturnWhereInput = completedSaleReturnWhere({
      ...dateWhere,
      ...(query.branchId
        ? { sale: { branchId: Math.floor(Number(query.branchId)) } }
        : {}),
    });

    const [pnlRevenue, legacyServiceGap, expenseAgg, cogs] = await Promise.all([
      sellerStylePnlRevenue(this.prisma, {
        saleWhere: saleForPnlWhere,
        incomeWhere: incomePnlWhere,
        saleReturnWhere,
      }),
      legacyPosServiceIncomeGap(this.prisma, saleForPnlWhere),
      this.prisma.expense.aggregate({
        where: sellerStyleExpenseWhere(expensePnlWhere),
        _sum: { amount: true },
      }),
      this.costing.cogsFromSoldItemsForSaleWhere(saleForPnlWhere),
    ]);

    const revenue = pnlRevenue.totalRevenue + legacyServiceGap;
    const grossProfit = revenue - cogs;
    const operatingExpenses = Number(expenseAgg._sum.amount ?? 0);
    const netProfit = grossProfit - operatingExpenses;

    type PreviousPeriodSummary = {
      revenue: number;
      cogs: number;
      grossProfit: number;
      operatingExpenses: number;
      otherIncome: number;
      netProfit: number;
    };
    let previousPeriod: PreviousPeriodSummary | null = null;
    const prevRange = previousPeriodRange(query);
    if (prevRange) {
      const prevSaleWhere: Prisma.SaleWhereInput = {
        createdAt: prevRange,
        ...branchFilter,
        status: { not: SaleStatus.RETURNED },
      };
      const prevIncomeWhere: Prisma.IncomeWhereInput = {
        date: prevRange,
        status: 'active',
        ...(query.branchId ? { branchId: query.branchId } : {}),
      };
      const prevReturnWhere: Prisma.SaleReturnWhereInput =
        completedSaleReturnWhere({
          createdAt: prevRange,
          ...(query.branchId
            ? { sale: { branchId: Math.floor(Number(query.branchId)) } }
            : {}),
        });

      const [prevPnl, prevLegacySvc, prevExpenses, prevCogs] = await Promise.all([
        sellerStylePnlRevenue(this.prisma, {
          saleWhere: prevSaleWhere,
          incomeWhere: prevIncomeWhere,
          saleReturnWhere: prevReturnWhere,
        }),
        legacyPosServiceIncomeGap(this.prisma, prevSaleWhere),
        this.prisma.expense.aggregate({
          where: sellerStyleExpenseWhere({
            date: prevRange,
            ...(query.branchId ? { branchId: query.branchId } : {}),
          }),
          _sum: { amount: true },
        }),
        this.costing.cogsFromSoldItemsForSaleWhere(prevSaleWhere),
      ]);

      const prevRevenue = prevPnl.totalRevenue + prevLegacySvc;
      const prevGross = prevRevenue - prevCogs;
      const prevOpExp = Number(prevExpenses._sum.amount ?? 0);
      const prevNetProfit = prevGross - prevOpExp;

      previousPeriod = {
        revenue: prevRevenue,
        cogs: prevCogs,
        grossProfit: prevGross,
        operatingExpenses: prevOpExp,
        otherIncome: prevPnl.otherIncome + prevPnl.serviceIncome,
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
        otherIncome: pnlRevenue.otherIncome + pnlRevenue.serviceIncome,
        operatingIncome: netProfit,
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
