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
import { Prisma, SaleStatus, AccountType, SupplierTransactionType } from '@prisma/client';
import {
  bdDayEndUtc,
  bdDayStartUtc,
  yearMonthKeyBd,
} from '../common/bd-time.js';
import { avgPurchaseUnitCostByStoreProductIds } from '../common/avg-purchase-unit-cost.js';
import {
  legacyPosServiceIncomeGap,
  sellerStyleExpenseWhere,
  sellerStylePnlRevenue,
  sellerStyleSupplierPayable,
} from '../common/seller-style-pnl.js';
import { completedSaleReturnWhere } from '../common/sale-return-seller.js';
import { ReportCostingService } from '../report/report-costing.service.js';

@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private readonly reportCosting: ReportCostingService,
  ) {}

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

  /** Same cost basis as reports: Σ batch cost / Σ batch initial qty, then purchase lines. */
  private tbAvgUnitCostByStoreProduct(storeProductIds: number[]) {
    return avgPurchaseUnitCostByStoreProductIds(this.prisma, storeProductIds);
  }

  /** COGS from sale lines: Σ qty × unit cost (not purchase receipts in period). */
  private async tbCogsFromSoldItems(
    saleWhere: Prisma.SaleWhereInput,
  ): Promise<number> {
    const items = await this.prisma.saleItem.findMany({
      where: { sale: saleWhere },
      select: { storeProductId: true, quantity: true, costPrice: true },
    });
    if (items.length === 0) return 0;
    const needFallback = items.filter(
      (i) => !i.costPrice || Number(i.costPrice) <= 0,
    );
    const storeIds = [...new Set(needFallback.map((i) => i.storeProductId))];
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
    const costMap = await this.tbAvgUnitCostByStoreProduct(stillNeedBatch);
    let sum = 0;
    for (const it of items) {
      const uc =
        it.costPrice != null && Number(it.costPrice) > 0
          ? Number(it.costPrice)
          : (spAvgMap.get(it.storeProductId) ?? 0) > 0
            ? (spAvgMap.get(it.storeProductId) ?? 0)
            : (costMap.get(it.storeProductId) ?? 0);
      sum += it.quantity * uc;
    }
    return sum;
  }

  /** COGS reversed when stock comes back from sale returns. */
  private async tbReturnCogs(
    saleReturnWhere: Prisma.SaleReturnWhereInput,
  ): Promise<number> {
    const items = await this.prisma.saleReturnItem.findMany({
      where: { saleReturn: completedSaleReturnWhere(saleReturnWhere) },
      select: {
        storeProductId: true,
        quantity: true,
        saleItemId: true,
        saleItem: { select: { costPrice: true } },
      },
    });
    if (items.length === 0) return 0;
    const needFallback = items.filter(
      (i) =>
        !i.saleItem ||
        i.saleItem.costPrice == null ||
        Number(i.saleItem.costPrice) <= 0,
    );
    const storeIds = [...new Set(needFallback.map((i) => i.storeProductId))];
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
    const costMap = await this.tbAvgUnitCostByStoreProduct(stillNeedBatch);
    let sum = 0;
    for (const it of items) {
      const uc =
        it.saleItem &&
        it.saleItem.costPrice != null &&
        Number(it.saleItem.costPrice) > 0
          ? Number(it.saleItem.costPrice)
          : (spAvgMap.get(it.storeProductId) ?? 0) > 0
            ? (spAvgMap.get(it.storeProductId) ?? 0)
            : (costMap.get(it.storeProductId) ?? 0);
      sum += it.quantity * uc;
    }
    return sum;
  }

  /**
   * Statement-style trial balance: assets, liabilities, owner equity, and A = L + E check.
   * Cash/bank/mobile accounts are organisation-wide (no branch on Account). Branch filters
   * sales due, inventory (batches), and branch-scoped P&amp;L (strict branch on income/expense).
   * Lifetime COGS uses sold items (same as profit report), minus return lines.
   * Inventory asset uses storeProduct WAC × qty (seller-admin variant.averageCost × stockQuantity),
   * not FIFO batch layers — so COGS snapshots and inventory stay on the same cost basis.
   */
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
        where: {
          status: { not: SaleStatus.RETURNED },
          ...saleBranch,
        },
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

    const saleForPnlWhere: Prisma.SaleWhereInput = {
      status: { not: SaleStatus.RETURNED },
      ...saleBranch,
    };
    const [cogsSold, returnCogs, pnlRevenue, legacyServiceGap, supplierPayable] =
      await Promise.all([
        this.tbCogsFromSoldItems(saleForPnlWhere),
        this.tbReturnCogs(saleReturnBranch),
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
     * − refunds + return gain; legacy service gap for old sales without income rows.
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
    const saleForPnl: Prisma.SaleWhereInput = {
      status: { not: SaleStatus.RETURNED },
    };
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
