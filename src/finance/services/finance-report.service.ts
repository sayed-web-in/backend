import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, AccountType, SupplierTransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { bdDayEndUtc, bdDayStartUtc, yearMonthKeyBd } from '../../common/bd-time.js';
import {
  legacyPosServiceIncomeGap,
  sellerStyleExpenseWhere,
  sellerStylePnlRevenue,
  sellerStyleSaleWhereForPnl,
  sellerStyleSupplierPayable,
} from '../../common/seller-style-pnl.js';
import {
  tbCogsFromSoldItems,
  tbReturnCogs,
} from '../helpers/finance-trial-balance-costing.js';
import { ReportCostingService } from '../../report/report-costing.service.js';

@Injectable()
export class FinanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportCosting: ReportCostingService,
  ) {}
  async getTrialBalance(branchId?: number) {
    const bid =
      branchId != null && Number.isFinite(Number(branchId))
        ? Math.floor(Number(branchId))
        : undefined;
    const saleBranch = bid != null ? { branchId: bid } : {};
    const storeProductBranch = bid != null ? { branchId: bid } : {};
    /** Match dashboard P&amp;L: branch-scoped income/expense only (no orphan `branchId: null` rows in branch view). */
    const incomeBranch = bid != null ? { branchId: bid } : {};
    const expenseBranch = bid != null ? { branchId: bid } : {};
    const saleReturnBranch =
      bid != null ? { sale: { branchId: bid } } : {};

    const toNum = (d: Prisma.Decimal | null | undefined) => Number(d ?? 0);

    const liquidTypes: AccountType[] = [
      AccountType.CASH,
      AccountType.BANK,
      AccountType.MOBILE_BANKING,
    ];

    const [
      liquidAccounts,
      salesDueAgg,
      manualDueAgg,
      supplierAdvanceAgg,
      customerAdvanceAgg,
      initialBatches,
      storeProductsForInventory,
      expenseAgg,
      openingCapitalAgg,
    ] = await Promise.all([
      this.prisma.account.findMany({
        where: { isActive: true, type: { in: liquidTypes } },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.sale.aggregate({
        where: sellerStyleSaleWhereForPnl(saleBranch),
        _sum: { dueAmount: true },
      }),
      this.prisma.customer.aggregate({
        _sum: { manualDue: true },
      }),
      this.prisma.supplier.aggregate({
        where: { isActive: true },
        _sum: { advanceBalance: true },
      }),
      this.prisma.customer.aggregate({
        _sum: { totalAdvance: true },
      }),
      this.prisma.batch.findMany({
        where: {
          batchType: 'initial',
          storeProduct: storeProductBranch,
        },
        select: { totalCost: true },
      }),
      this.prisma.storeProduct.findMany({
        where: storeProductBranch,
        select: { quantity: true, averageCost: true },
      }),
      this.prisma.expense.aggregate({
        where: sellerStyleExpenseWhere(expenseBranch),
        _sum: { amount: true },
      }),
      this.prisma.account.aggregate({
        where: { isActive: true, type: { in: liquidTypes } },
        _sum: { openingBalance: true },
      }),
    ]);

    /** Seller-admin: Σ (averageCost × stockQuantity) per branch listing. */
    let inventoryValue = 0;
    for (const sp of storeProductsForInventory) {
      const qty = Number(sp.quantity);
      if (qty > 0) {
        inventoryValue += qty * toNum(sp.averageCost);
      }
    }

    /**
     * Full at-cost opening stock ever added via initial batches (seller-style gross),
     * including batches already sold out — needed so supplier “opening stock” due offsets equity.
     */
    let openingInventoryCapitalGrossFull = 0;
    for (const b of initialBatches) {
      openingInventoryCapitalGrossFull += toNum(b.totalCost);
    }

    let supplierIdsForOiBranch: number[] | undefined;
    if (bid != null) {
      const [pSup, bSup] = await Promise.all([
        this.prisma.purchase.findMany({
          where: { branchId: bid, supplierId: { not: null } },
          select: { supplierId: true },
          distinct: ['supplierId'],
        }),
        this.prisma.batch.findMany({
          where: {
            batchType: 'initial',
            storeProduct: { branchId: bid },
          },
          select: { supplierId: true },
        }),
      ]);
      const ids = new Set<number>();
      for (const r of pSup) {
        if (r.supplierId != null) ids.add(r.supplierId);
      }
      for (const r of bSup) {
        if (r.supplierId != null) ids.add(r.supplierId);
      }
      supplierIdsForOiBranch = [...ids];
    }

    const oiTxWhere: Prisma.SupplierTransactionWhereInput = {
      type: SupplierTransactionType.DUE,
      offsetsOpeningInventory: true,
      ...(bid != null && supplierIdsForOiBranch && supplierIdsForOiBranch.length > 0
        ? { supplierId: { in: supplierIdsForOiBranch } }
        : {}),
    };
    const oiPostedAgg = await this.prisma.supplierTransaction.aggregate({
      where: oiTxWhere,
      _sum: { amount: true },
    });
    /** Cumulative posted “Funded from opening stock” supplier Due (full amount on supplier ledger). */
    const openingInventorySupplierDuePostedTotal = toNum(oiPostedAgg._sum.amount);
    /**
     * Portion of that due that reduces opening-inventory equity (capped at gross opening stock at cost).
     * Same meaning as seller-admin `openingInventoryCapitalSupplierDueOffset` on the TB payload.
     */
    const openingInventoryCapitalSupplierDueOffset = Math.min(
      openingInventoryCapitalGrossFull,
      openingInventorySupplierDuePostedTotal,
    );

    const openingInventoryCapitalGross = openingInventoryCapitalGrossFull;
    const offsetApplied = openingInventoryCapitalSupplierDueOffset;
    const openingInventoryCapital = Math.max(
      0,
      openingInventoryCapitalGrossFull - offsetApplied,
    );
    /**
     * Posted OI due beyond recorded opening stock at cost stays in `supplierPayable`; apply same equity
     * plug as before so A ≈ L + E (not shown as a second line in UI — seller caps the “Less” row only).
     */
    const excessOiDueOverOpeningInventoryGross = Math.max(
      0,
      openingInventorySupplierDuePostedTotal - openingInventoryCapitalGrossFull,
    );
    const supplierOpeningDueEquityAdjustment = -excessOiDueOverOpeningInventoryGross;

    const saleForPnlWhere: Prisma.SaleWhereInput =
      sellerStyleSaleWhereForPnl(saleBranch);
    const [cogsSold, returnCogs, pnlRevenue, legacyServiceGap, supplierPayable] =
      await Promise.all([
        tbCogsFromSoldItems(this.prisma, saleForPnlWhere),
        tbReturnCogs(this.prisma, saleReturnBranch),
        sellerStylePnlRevenue(this.prisma, {
          saleWhere: saleForPnlWhere,
          incomeWhere: incomeBranch,
          saleReturnWhere: saleReturnBranch,
        }),
        legacyPosServiceIncomeGap(this.prisma, saleForPnlWhere),
        sellerStyleSupplierPayable(this.prisma, bid),
      ]);
    const cogsNet = Math.max(0, cogsSold - returnCogs);

    const operatingExpenses = toNum(expenseAgg._sum.amount);
    const serviceIncomeTotal =
      pnlRevenue.serviceIncome + legacyServiceGap;
    /**
     * Seller-admin: product sales (excl. POS service) + service/other income
     * − refunds (return gain via return COGS + refunds, not double-counted as income); legacy service gap.
     */
    const totalRevenue =
      pnlRevenue.productSales +
      serviceIncomeTotal +
      pnlRevenue.otherIncome -
      pnlRevenue.refundTotal;
    const totalExpense = cogsNet + operatingExpenses;
    const cumulativeNetProfit = totalRevenue - totalExpense;

    const totalCash = liquidAccounts.reduce((s, a) => s + toNum(a.balance), 0);
    const saleDue = toNum(salesDueAgg._sum.dueAmount);
    const manualDue = toNum(manualDueAgg._sum.manualDue);
    /** Invoice-level due (branch-scoped) + manual due (customer-level, not branch-scoped). */
    const customerReceivable = saleDue + manualDue;

    const supplierAdvanceReceivable = toNum(supplierAdvanceAgg._sum.advanceBalance);
    const customerAdvance = toNum(customerAdvanceAgg._sum.totalAdvance);

    const totalOpeningCapital = toNum(openingCapitalAgg._sum.openingBalance);
    const netStockAdjustment = 0;
    const totalProfitWithdrawn = 0;
    const salaryAccrual = 0;
    const retailerReceivable = 0;
    const employeeAdvanceReceivable = 0;
    const retailerAdvance = 0;
    const salaryDue = 0;
    const cashDepositPayable = 0;

    const totalLiquidAndOpsAssets =
      totalCash +
      customerReceivable +
      retailerReceivable +
      employeeAdvanceReceivable +
      supplierAdvanceReceivable +
      inventoryValue;

    const totalLiabilities =
      supplierPayable +
      customerAdvance +
      retailerAdvance +
      salaryDue +
      cashDepositPayable;

    const retainedEarnings =
      cumulativeNetProfit - totalProfitWithdrawn - salaryAccrual;
    const totalOwnerEquity =
      totalOpeningCapital +
      openingInventoryCapital +
      netStockAdjustment +
      retainedEarnings +
      supplierOpeningDueEquityAdjustment;

    const totalAssets = totalLiquidAndOpsAssets;
    const netWorth = totalAssets - totalLiabilities;
    const rawDifference = netWorth - totalOwnerEquity;
    /** Same as seller-admin: positive magnitude only; balanced when &lt; 0.01. */
    const difference = Math.abs(rawDifference);
    const isBalanced = difference < 0.01;

    const accountTypeLabel: Record<string, string> = {
      CASH: 'Cash',
      BANK: 'Bank',
      MOBILE_BANKING: 'Mobile Banking',
    };

    const cashAccounts = liquidAccounts.map((a) => ({
      id: String(a.id),
      accountName: a.name,
      accountType: accountTypeLabel[a.type] ?? a.type,
      accountNumber: a.accountNumber ?? null,
      balance: toNum(a.balance),
      branch: { id: '0', name: bid != null ? `Branch #${bid}` : 'All branches' },
    }));

    return {
      branchId: bid ?? null,
      assets: {
        cashAccounts,
        totalCash,
        customerReceivable,
        customerInvoiceDue: saleDue,
        customerManualDue: manualDue,
        retailerReceivable,
        inventoryValue,
        employeeAdvanceReceivable,
        supplierAdvanceReceivable,
        totalAssets,
      },
      liabilities: {
        supplierPayable,
        customerAdvance,
        retailerAdvance,
        salaryDue,
        cashDepositPayable,
        totalLiabilities,
      },
      equity: {
        totalOpeningCapital,
        openingInventoryCapitalGross,
        openingInventoryCapitalSupplierDueOffset,
        openingInventorySupplierDuePostedTotal,
        openingInventoryCapital,
        netStockAdjustment,
        totalRevenue,
        totalExpense,
        cumulativeNetProfit,
        totalProfitWithdrawn,
        retainedEarnings,
        salaryAccrual,
        totalOwnerEquity,
      },
      summary: {
        totalAssets,
        totalLiabilities,
        netWorth,
        totalOwnerEquity,
        retainedEarnings,
        difference,
        isBalanced,
      },
    };
  }

  async getCashFlow(dateFrom?: string, dateTo?: string) {
    const where: any = {};
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.createdAt.lte = bdDayEndUtc(dateTo);
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { account: true },
    });

    let totalInflow = new Prisma.Decimal(0);
    let totalOutflow = new Prisma.Decimal(0);
    const monthlyBreakdown: Record<
      string,
      { inflow: Prisma.Decimal; outflow: Prisma.Decimal; net: Prisma.Decimal }
    > = {};

    for (const txn of transactions) {
      const monthKey = yearMonthKeyBd(txn.createdAt);

      if (!monthlyBreakdown[monthKey]) {
        monthlyBreakdown[monthKey] = {
          inflow: new Prisma.Decimal(0),
          outflow: new Prisma.Decimal(0),
          net: new Prisma.Decimal(0),
        };
      }

      if (txn.type === 'CREDIT') {
        totalInflow = totalInflow.add(txn.amount);
        monthlyBreakdown[monthKey].inflow = monthlyBreakdown[
          monthKey
        ].inflow.add(txn.amount);
      } else {
        totalOutflow = totalOutflow.add(txn.amount);
        monthlyBreakdown[monthKey].outflow = monthlyBreakdown[
          monthKey
        ].outflow.add(txn.amount);
      }
      monthlyBreakdown[monthKey].net = monthlyBreakdown[monthKey].inflow.sub(
        monthlyBreakdown[monthKey].outflow,
      );
    }

    return {
      totalInflow,
      totalOutflow,
      netFlow: totalInflow.sub(totalOutflow),
      monthlyBreakdown,
    };
  }

  async getAccountStatement(
    accountId: number,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const where: any = { accountId };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.createdAt.lte = bdDayEndUtc(dateTo);
    }

    // Get balance before the date range for opening balance
    let openingBalance = new Prisma.Decimal(0);
    if (dateFrom) {
      const priorCredits = await this.prisma.transaction.aggregate({
        where: {
          accountId,
          type: 'CREDIT',
          createdAt: { lt: bdDayStartUtc(dateFrom) },
        },
        _sum: { amount: true },
      });
      const priorDebits = await this.prisma.transaction.aggregate({
        where: {
          accountId,
          type: 'DEBIT',
          createdAt: { lt: bdDayStartUtc(dateFrom) },
        },
        _sum: { amount: true },
      });

      const credits = priorCredits._sum.amount ?? new Prisma.Decimal(0);
      const debits = priorDebits._sum.amount ?? new Prisma.Decimal(0);
      openingBalance = credits.sub(debits);
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    let runningBalance = openingBalance;
    const statement = transactions.map((txn) => {
      if (txn.type === 'CREDIT') {
        runningBalance = runningBalance.add(txn.amount);
      } else {
        runningBalance = runningBalance.sub(txn.amount);
      }
      return { ...txn, runningBalance };
    });

    return {
      account,
      openingBalance,
      closingBalance: runningBalance,
      transactions: statement,
    };
  }

  async getProfitAndLoss(dateFrom?: string, dateTo?: string) {
    const saleForPnl: Prisma.SaleWhereInput = sellerStyleSaleWhereForPnl();
    const incomeWhere: Prisma.IncomeWhereInput = {};
    const expenseWhere: Prisma.ExpenseWhereInput = {};
    if (dateFrom || dateTo) {
      saleForPnl.createdAt = {};
      incomeWhere.date = {};
      expenseWhere.date = {};
      if (dateFrom) {
        const gte = bdDayStartUtc(dateFrom);
        saleForPnl.createdAt.gte = gte;
        incomeWhere.date.gte = gte;
        expenseWhere.date.gte = gte;
      }
      if (dateTo) {
        const lte = bdDayEndUtc(dateTo);
        saleForPnl.createdAt.lte = lte;
        incomeWhere.date.lte = lte;
        expenseWhere.date.lte = lte;
      }
    }

    const [pnlRevenue, legacyServiceGap, cogsDec, expenseResult] =
      await Promise.all([
        sellerStylePnlRevenue(this.prisma, {
          saleWhere: saleForPnl,
          incomeWhere,
        }),
        legacyPosServiceIncomeGap(this.prisma, saleForPnl),
        this.reportCosting.cogsFromSoldItemsForSaleWhere(saleForPnl),
        this.prisma.expense.aggregate({
          where: sellerStyleExpenseWhere(expenseWhere),
          _sum: { amount: true },
        }),
      ]);

    const revenue = new Prisma.Decimal(
      pnlRevenue.totalRevenue + legacyServiceGap,
    );
    const cogs = new Prisma.Decimal(cogsDec);
    const grossProfit = revenue.sub(cogs);
    const operatingExpenses =
      expenseResult._sum.amount ?? new Prisma.Decimal(0);
    const netProfit = grossProfit.sub(operatingExpenses);

    return {
      revenue,
      cogs,
      grossProfit,
      operatingExpenses,
      netProfit,
    };
  }
}
