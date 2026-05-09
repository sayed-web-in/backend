import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { TransferFundsDto } from './dto/transfer-funds.dto.js';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { CreateIncomeCategoryDto } from './dto/create-income-category.dto.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';
import { CreateTaxRateDto } from './dto/create-tax-rate.dto.js';
import { FinanceQueryDto } from './dto/finance-query.dto.js';
import { paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';
import {
  bdDayEndUtc,
  bdDayStartUtc,
  yearMonthKeyBd,
} from '../common/bd-time.js';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  private expenseWhereFromQuery(query: FinanceQueryDto) {
    const { categoryId, branchId, dateFrom, dateTo, search } = query;
    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (branchId != null && Number.isFinite(branchId)) {
      where.branchId = Math.floor(Number(branchId));
    }
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.date.lte = bdDayEndUtc(dateTo);
    }
    if (search) {
      where.OR = [
        { note: { contains: search } },
        { name: { contains: search } },
        { reference: { contains: search } },
        { category: { name: { contains: search } } },
      ];
    }
    return where;
  }

  private expenseDateFromYmd(d?: string): Date {
    if (!d) return new Date();
    return bdDayStartUtc(d.slice(0, 10));
  }

  private incomeWhereFromQuery(query: FinanceQueryDto) {
    const { categoryId, branchId, dateFrom, dateTo, search } = query;
    const where: any = {};
    if (categoryId) where.categoryId = categoryId;
    if (branchId != null && Number.isFinite(branchId)) {
      where.branchId = Math.floor(Number(branchId));
    }
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.date.lte = bdDayEndUtc(dateTo);
    }
    if (search) {
      where.OR = [
        { note: { contains: search } },
        { name: { contains: search } },
        { reference: { contains: search } },
        { category: { name: { contains: search } } },
      ];
    }
    return where;
  }

  // ─── ACCOUNTS ───────────────────────────────────────────────

  async getAccounts() {
    return this.prisma.account.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { transactions: true } } },
    });
  }

  async createAccount(dto: CreateAccountDto) {
    const opening = new Prisma.Decimal(
      dto.openingBalance ?? dto.balance ?? 0,
    );
    return this.prisma.account.create({
      data: {
        name: dto.name,
        accountNumber: dto.accountNumber,
        type: dto.type,
        openingBalance: opening,
        balance: opening,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateAccount(id: number, dto: Partial<CreateAccountDto>) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Account not found');

    const data: Prisma.AccountUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.accountNumber !== undefined)
      data.accountNumber = dto.accountNumber;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.openingBalance !== undefined) {
      const newOp = new Prisma.Decimal(dto.openingBalance);
      const oldOp = new Prisma.Decimal(account.openingBalance);
      const delta = newOp.sub(oldOp);
      data.openingBalance = newOp;
      data.balance = new Prisma.Decimal(account.balance).add(delta);
    } else if (dto.balance !== undefined) {
      data.balance = new Prisma.Decimal(dto.balance);
    }

    return this.prisma.account.update({ where: { id }, data });
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
      if (dateFrom) where.createdAt.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.createdAt.lte = bdDayEndUtc(dateTo);
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

  async transferFunds(dto: TransferFundsDto) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException(
        'Source and destination accounts must be different',
      );
    }

    const decAmount = new Prisma.Decimal(dto.amount);
    if (decAmount.lte(0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    return this.prisma.$transaction(async (tx) => {
      const from = await tx.account.findUnique({
        where: { id: dto.fromAccountId },
      });
      const to = await tx.account.findUnique({
        where: { id: dto.toAccountId },
      });
      if (!from || !to) {
        throw new NotFoundException('Account not found');
      }

      const available = new Prisma.Decimal(from.balance);
      if (available.lessThan(decAmount)) {
        throw new BadRequestException(
          'Insufficient balance in the source account',
        );
      }

      const ref =
        dto.reference?.trim() ||
        `TRF-${Date.now().toString(36).toUpperCase()}`;
      const note = dto.description?.trim();
      const debitDesc = note || `Transfer to ${to.name}`;
      const creditDesc = note || `Transfer from ${from.name}`;

      await tx.transaction.create({
        data: {
          accountId: dto.fromAccountId,
          type: 'DEBIT',
          amount: decAmount,
          reference: ref,
          description: debitDesc,
        },
      });
      await tx.account.update({
        where: { id: dto.fromAccountId },
        data: { balance: { decrement: decAmount } },
      });

      await tx.transaction.create({
        data: {
          accountId: dto.toAccountId,
          type: 'CREDIT',
          amount: decAmount,
          reference: ref,
          description: creditDesc,
        },
      });
      await tx.account.update({
        where: { id: dto.toAccountId },
        data: { balance: { increment: decAmount } },
      });

      return { reference: ref };
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

    const where = this.expenseWhereFromQuery(query);

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
        include: {
          category: true,
          branch: true,
          account: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.expense.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getExpenseSummary(query: FinanceQueryDto) {
    const where: any = {
      AND: [this.expenseWhereFromQuery(query), { status: 'active' }],
    };
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const [totalAgg, monthAgg, dayAgg] = await Promise.all([
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
      this.prisma.expense.aggregate({
        where: { AND: [where, { date: { gte: monthStart, lte: monthEnd } }] },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { AND: [where, { date: { gte: dayStart, lte: dayEnd } }] },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalExpenses: Number(totalAgg._sum.amount ?? 0),
      thisMonthExpenses: Number(monthAgg._sum.amount ?? 0),
      todayExpenses: Number(dayAgg._sum.amount ?? 0),
    };
  }

  async createExpense(dto: CreateExpenseDto) {
    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException('Expense name is required');
    }
    if (dto.branchId == null || !Number.isFinite(dto.branchId)) {
      throw new BadRequestException('Branch is required');
    }

    const statusNorm = (dto.status || 'active').trim().toLowerCase();
    const postToAccount = statusNorm === 'active';

    if (postToAccount) {
      if (!dto.accountId) {
        throw new BadRequestException(
          'Account is required when status is Active — amount debits that account',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          branchId: Math.floor(Number(dto.branchId)),
          categoryId: dto.categoryId,
          accountId: postToAccount ? dto.accountId! : (dto.accountId ?? null),
          name,
          reference: dto.reference?.trim() || null,
          status: statusNorm,
          amount: dto.amount,
          note: dto.note?.trim() || null,
          date: this.expenseDateFromYmd(dto.date),
        },
        include: {
          category: true,
          branch: true,
          account: { select: { id: true, name: true, type: true } },
        },
      });

      if (postToAccount && dto.accountId) {
        const account = await tx.account.findUnique({
          where: { id: dto.accountId },
        });
        if (!account) throw new NotFoundException('Account not found');
        if (!account.isActive) {
          throw new BadRequestException('Account is inactive');
        }

        const label =
          name ||
          dto.note?.trim() ||
          expense.category?.name ||
          'Expense';

        await tx.transaction.create({
          data: {
            accountId: dto.accountId,
            type: 'DEBIT',
            amount: dto.amount,
            reference: dto.reference?.trim() || `EXP-${expense.id}`,
            description: label,
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
    if (dto.branchId !== undefined) {
      data.branchId =
        dto.branchId != null && Number.isFinite(dto.branchId)
          ? Math.floor(Number(dto.branchId))
          : null;
    }
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;
    if (dto.name !== undefined) data.name = dto.name?.trim() || null;
    if (dto.reference !== undefined) {
      data.reference = dto.reference?.trim() || null;
    }
    if (dto.status !== undefined) {
      data.status = dto.status.trim().toLowerCase() || 'active';
    }
    if (dto.date !== undefined) data.date = this.expenseDateFromYmd(dto.date);

    return this.prisma.expense.update({
      where: { id },
      data,
      include: {
        category: true,
        branch: true,
        account: { select: { id: true, name: true, type: true } },
      },
    });
  }

  async deleteExpense(id: number) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');

    const wasActive =
      (expense.status || 'active').toLowerCase() === 'active' &&
      expense.accountId != null;

    return this.prisma.$transaction(async (tx) => {
      if (wasActive) {
        const account = await tx.account.findUnique({
          where: { id: expense.accountId! },
        });
        if (account) {
          await tx.transaction.create({
            data: {
              accountId: expense.accountId!,
              type: 'CREDIT',
              amount: expense.amount,
              reference: `EXP-REV-${id}`,
              description: `Reversal: deleted expense #${id}`,
            },
          });
          await tx.account.update({
            where: { id: expense.accountId! },
            data: {
              balance: { increment: new Prisma.Decimal(expense.amount) },
            },
          });
        }
      }
      return tx.expense.delete({ where: { id } });
    });
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

    const where = this.incomeWhereFromQuery(query);

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
        include: {
          category: true,
          branch: true,
          account: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.income.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getIncomeSummary(query: FinanceQueryDto) {
    const where: any = {
      AND: [this.incomeWhereFromQuery(query), { status: 'active' }],
    };
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const [totalAgg, monthAgg, dayAgg] = await Promise.all([
      this.prisma.income.aggregate({ where, _sum: { amount: true } }),
      this.prisma.income.aggregate({
        where: { AND: [where, { date: { gte: monthStart, lte: monthEnd } }] },
        _sum: { amount: true },
      }),
      this.prisma.income.aggregate({
        where: { AND: [where, { date: { gte: dayStart, lte: dayEnd } }] },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalIncome: Number(totalAgg._sum.amount ?? 0),
      thisMonthIncome: Number(monthAgg._sum.amount ?? 0),
      todayIncome: Number(dayAgg._sum.amount ?? 0),
    };
  }

  async createIncome(dto: CreateIncomeDto) {
    const statusNorm = (dto.status || 'active').trim().toLowerCase();
    const postToAccount = statusNorm === 'active';

    return this.prisma.$transaction(async (tx) => {
      const income = await tx.income.create({
        data: {
          branchId: dto.branchId ?? null,
          categoryId: dto.categoryId,
          accountId: dto.accountId ?? null,
          name: dto.name?.trim() || null,
          amount: dto.amount,
          note: dto.note?.trim() || null,
          reference: dto.reference?.trim() || null,
          status: statusNorm,
          date: dto.date ? new Date(dto.date) : new Date(),
        },
        include: {
          category: true,
          branch: true,
          account: { select: { id: true, name: true, type: true } },
        },
      });

      if (postToAccount && dto.accountId) {
        const account = await tx.account.findUnique({
          where: { id: dto.accountId },
        });
        if (!account) throw new NotFoundException('Account not found');
        if (!account.isActive) {
          throw new BadRequestException('Account is inactive');
        }

        const label =
          dto.name?.trim() ||
          dto.note?.trim() ||
          income.category?.name ||
          'Income';

        await tx.transaction.create({
          data: {
            accountId: dto.accountId,
            type: 'CREDIT',
            amount: dto.amount,
            reference: dto.reference?.trim() || `INC-${income.id}`,
            description: label,
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
    if (dto.branchId !== undefined) data.branchId = dto.branchId;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;
    if (dto.name !== undefined) data.name = dto.name?.trim() || null;
    if (dto.reference !== undefined) data.reference = dto.reference?.trim() || null;
    if (dto.status !== undefined)
      data.status = dto.status.trim().toLowerCase() || 'active';
    if (dto.date !== undefined) data.date = new Date(dto.date);

    return this.prisma.income.update({
      where: { id },
      data,
      include: {
        category: true,
        branch: true,
        account: { select: { id: true, name: true, type: true } },
      },
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

    const grouped: Record<
      string,
      { accounts: typeof accounts; total: Prisma.Decimal }
    > = {};
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
    const dateFilter: any = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt.gte = bdDayStartUtc(dateFrom);
      if (dateTo) dateFilter.createdAt.lte = bdDayEndUtc(dateTo);
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
    const expenseDateFilter: any = { status: 'active' };
    if (dateFrom || dateTo) {
      expenseDateFilter.date = {};
      if (dateFrom) expenseDateFilter.date.gte = bdDayStartUtc(dateFrom);
      if (dateTo) expenseDateFilter.date.lte = bdDayEndUtc(dateTo);
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
