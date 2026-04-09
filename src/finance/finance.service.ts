import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { CreateIncomeCategoryDto } from './dto/create-income-category.dto.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';
import { CreateTaxRateDto } from './dto/create-tax-rate.dto.js';
import { FinanceQueryDto } from './dto/finance-query.dto.js';
import { paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  // ─── ACCOUNTS ───────────────────────────────────────────────

  async getAccounts() {
    return this.prisma.account.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { transactions: true } } },
    });
  }

  async createAccount(dto: CreateAccountDto) {
    return this.prisma.account.create({
      data: {
        name: dto.name,
        accountNumber: dto.accountNumber,
        type: dto.type,
        balance: dto.balance ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateAccount(id: number, dto: Partial<CreateAccountDto>) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Account not found');
    return this.prisma.account.update({ where: { id }, data: dto });
  }

  async deleteAccount(id: number) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Account not found');
    return this.prisma.account.delete({ where: { id } });
  }

  // ─── TRANSACTIONS ──────────────────────────────────────────

  async getTransactions(query: FinanceQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      accountId,
      type,
      dateFrom,
      dateTo,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { reference: { contains: search } },
        { description: { contains: search } },
      ];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { account: true },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async createTransaction(dto: CreateTransactionDto) {
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });
    if (!account) throw new NotFoundException('Account not found');

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          accountId: dto.accountId,
          type: dto.type,
          amount: dto.amount,
          reference: dto.reference,
          description: dto.description,
        },
        include: { account: true },
      });

      const balanceUpdate =
        dto.type === 'CREDIT'
          ? { increment: new Prisma.Decimal(dto.amount) }
          : { decrement: new Prisma.Decimal(dto.amount) };

      await tx.account.update({
        where: { id: dto.accountId },
        data: { balance: balanceUpdate },
      });

      return transaction;
    });
  }

  // ─── EXPENSE CATEGORIES ────────────────────────────────────

  async getExpenseCategories() {
    return this.prisma.expenseCategory.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { expenses: true } } },
    });
  }

  async createExpenseCategory(dto: CreateExpenseCategoryDto) {
    return this.prisma.expenseCategory.create({
      data: {
        name: dto.name,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateExpenseCategory(
    id: number,
    dto: Partial<CreateExpenseCategoryDto>,
  ) {
    const category = await this.prisma.expenseCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Expense category not found');
    return this.prisma.expenseCategory.update({ where: { id }, data: dto });
  }

  async deleteExpenseCategory(id: number) {
    const category = await this.prisma.expenseCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Expense category not found');
    return this.prisma.expenseCategory.delete({ where: { id } });
  }

  // ─── EXPENSES ──────────────────────────────────────────────

  async getExpenses(query: FinanceQueryDto) {
    const {
      page = 1,
      limit = 16,
      categoryId,
      dateFrom,
      dateTo,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.date = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { category: true },
      }),
      this.prisma.expense.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async createExpense(dto: CreateExpenseDto) {
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          categoryId: dto.categoryId,
          accountId: dto.accountId,
          amount: dto.amount,
          note: dto.note,
          date: dto.date ? new Date(dto.date) : new Date(),
        },
        include: { category: true },
      });

      if (dto.accountId) {
        const account = await tx.account.findUnique({
          where: { id: dto.accountId },
        });
        if (!account) throw new NotFoundException('Account not found');

        await tx.transaction.create({
          data: {
            accountId: dto.accountId,
            type: 'DEBIT',
            amount: dto.amount,
            reference: `EXP-${expense.id}`,
            description: `Expense: ${dto.note || 'No description'}`,
          },
        });

        await tx.account.update({
          where: { id: dto.accountId },
          data: { balance: { decrement: new Prisma.Decimal(dto.amount) } },
        });
      }

      return expense;
    });
  }

  async updateExpense(id: number, dto: Partial<CreateExpenseDto>) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');

    const data: any = {};
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.accountId !== undefined) data.accountId = dto.accountId;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.date !== undefined) data.date = new Date(dto.date);

    return this.prisma.expense.update({
      where: { id },
      data,
      include: { category: true },
    });
  }

  async deleteExpense(id: number) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');
    return this.prisma.expense.delete({ where: { id } });
  }

  // ─── INCOME CATEGORIES ────────────────────────────────────

  async getIncomeCategories() {
    return this.prisma.incomeCategory.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { incomes: true } } },
    });
  }

  async createIncomeCategory(dto: CreateIncomeCategoryDto) {
    return this.prisma.incomeCategory.create({
      data: {
        name: dto.name,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateIncomeCategory(
    id: number,
    dto: Partial<CreateIncomeCategoryDto>,
  ) {
    const category = await this.prisma.incomeCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Income category not found');
    return this.prisma.incomeCategory.update({ where: { id }, data: dto });
  }

  async deleteIncomeCategory(id: number) {
    const category = await this.prisma.incomeCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Income category not found');
    return this.prisma.incomeCategory.delete({ where: { id } });
  }

  // ─── INCOMES ───────────────────────────────────────────────

  async getIncomes(query: FinanceQueryDto) {
    const {
      page = 1,
      limit = 16,
      categoryId,
      dateFrom,
      dateTo,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.date = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.income.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { category: true },
      }),
      this.prisma.income.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async createIncome(dto: CreateIncomeDto) {
    return this.prisma.$transaction(async (tx) => {
      const income = await tx.income.create({
        data: {
          categoryId: dto.categoryId,
          accountId: dto.accountId,
          amount: dto.amount,
          note: dto.note,
          date: dto.date ? new Date(dto.date) : new Date(),
        },
        include: { category: true },
      });

      if (dto.accountId) {
        const account = await tx.account.findUnique({
          where: { id: dto.accountId },
        });
        if (!account) throw new NotFoundException('Account not found');

        await tx.transaction.create({
          data: {
            accountId: dto.accountId,
            type: 'CREDIT',
            amount: dto.amount,
            reference: `INC-${income.id}`,
            description: `Income: ${dto.note || 'No description'}`,
          },
        });

        await tx.account.update({
          where: { id: dto.accountId },
          data: { balance: { increment: new Prisma.Decimal(dto.amount) } },
        });
      }

      return income;
    });
  }

  async updateIncome(id: number, dto: Partial<CreateIncomeDto>) {
    const income = await this.prisma.income.findUnique({ where: { id } });
    if (!income) throw new NotFoundException('Income not found');

    const data: any = {};
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.accountId !== undefined) data.accountId = dto.accountId;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.date !== undefined) data.date = new Date(dto.date);

    return this.prisma.income.update({
      where: { id },
      data,
      include: { category: true },
    });
  }

  async deleteIncome(id: number) {
    const income = await this.prisma.income.findUnique({ where: { id } });
    if (!income) throw new NotFoundException('Income not found');
    return this.prisma.income.delete({ where: { id } });
  }

  // ─── REPORTS ───────────────────────────────────────────────

  async getTrialBalance() {
    const accounts = await this.prisma.account.findMany({
      where: { isActive: true },
    });

    const grouped: Record<string, { accounts: typeof accounts; total: Prisma.Decimal }> = {};
    let totalAssets = new Prisma.Decimal(0);

    for (const acc of accounts) {
      if (!grouped[acc.type]) {
        grouped[acc.type] = { accounts: [], total: new Prisma.Decimal(0) };
      }
      grouped[acc.type].accounts.push(acc);
      grouped[acc.type].total = grouped[acc.type].total.add(acc.balance);
      totalAssets = totalAssets.add(acc.balance);
    }

    const debitResult = await this.prisma.transaction.aggregate({
      where: { type: 'DEBIT' },
      _sum: { amount: true },
    });
    const totalLiabilities = debitResult._sum.amount ?? new Prisma.Decimal(0);

    const ownersEquity = totalAssets.sub(totalLiabilities);

    return {
      accountsByType: grouped,
      totalAssets,
      totalLiabilities,
      ownersEquity,
    };
  }

  async getCashFlow(dateFrom?: string, dateTo?: string) {
    const where: any = {};
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
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
      const monthKey = `${txn.createdAt.getFullYear()}-${String(txn.createdAt.getMonth() + 1).padStart(2, '0')}`;

      if (!monthlyBreakdown[monthKey]) {
        monthlyBreakdown[monthKey] = {
          inflow: new Prisma.Decimal(0),
          outflow: new Prisma.Decimal(0),
          net: new Prisma.Decimal(0),
        };
      }

      if (txn.type === 'CREDIT') {
        totalInflow = totalInflow.add(txn.amount);
        monthlyBreakdown[monthKey].inflow =
          monthlyBreakdown[monthKey].inflow.add(txn.amount);
      } else {
        totalOutflow = totalOutflow.add(txn.amount);
        monthlyBreakdown[monthKey].outflow =
          monthlyBreakdown[monthKey].outflow.add(txn.amount);
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
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    // Get balance before the date range for opening balance
    let openingBalance = new Prisma.Decimal(0);
    if (dateFrom) {
      const priorCredits = await this.prisma.transaction.aggregate({
        where: {
          accountId,
          type: 'CREDIT',
          createdAt: { lt: new Date(dateFrom) },
        },
        _sum: { amount: true },
      });
      const priorDebits = await this.prisma.transaction.aggregate({
        where: {
          accountId,
          type: 'DEBIT',
          createdAt: { lt: new Date(dateFrom) },
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
    const dateFilter: any = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt.gte = new Date(dateFrom);
      if (dateTo) dateFilter.createdAt.lte = new Date(dateTo);
    }

    // Revenue: sum of sales grandTotal
    const salesResult = await this.prisma.sale.aggregate({
      where: { ...dateFilter, status: { not: 'RETURNED' } },
      _sum: { grandTotal: true },
    });
    const revenue = salesResult._sum.grandTotal ?? new Prisma.Decimal(0);

    // COGS: sum of purchase items unitCost * quantity
    const purchaseItems = await this.prisma.purchaseItem.findMany({
      where: { purchase: dateFilter },
      select: { unitCost: true, quantity: true },
    });
    let cogs = new Prisma.Decimal(0);
    for (const item of purchaseItems) {
      cogs = cogs.add(item.unitCost.mul(new Prisma.Decimal(item.quantity)));
    }

    const grossProfit = revenue.sub(cogs);

    // Operating Expenses
    const expenseDateFilter: any = {};
    if (dateFrom || dateTo) {
      expenseDateFilter.date = {};
      if (dateFrom) expenseDateFilter.date.gte = new Date(dateFrom);
      if (dateTo) expenseDateFilter.date.lte = new Date(dateTo);
    }

    const expenseResult = await this.prisma.expense.aggregate({
      where: expenseDateFilter,
      _sum: { amount: true },
    });
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

  // ─── TAX RATES ─────────────────────────────────────────────

  async getTaxRates() {
    return this.prisma.taxRate.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createTaxRate(dto: CreateTaxRateDto) {
    return this.prisma.taxRate.create({
      data: {
        name: dto.name,
        rate: dto.rate,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateTaxRate(id: number, dto: Partial<CreateTaxRateDto>) {
    const taxRate = await this.prisma.taxRate.findUnique({ where: { id } });
    if (!taxRate) throw new NotFoundException('Tax rate not found');
    return this.prisma.taxRate.update({ where: { id }, data: dto });
  }

  async deleteTaxRate(id: number) {
    const taxRate = await this.prisma.taxRate.findUnique({ where: { id } });
    if (!taxRate) throw new NotFoundException('Tax rate not found');
    return this.prisma.taxRate.delete({ where: { id } });
  }
}
