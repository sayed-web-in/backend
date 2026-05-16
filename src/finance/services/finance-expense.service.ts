import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateExpenseCategoryDto } from '../dto/create-expense-category.dto.js';
import { CreateExpenseDto } from '../dto/create-expense.dto.js';
import { FinanceQueryDto } from '../dto/finance-query.dto.js';
import { paginate } from '../../common/pagination.dto.js';
import {
  expenseDateFromYmd,
  expenseWhereFromQuery,
} from '../helpers/finance-query.filters.js';

@Injectable()
export class FinanceExpenseService {
  constructor(private readonly prisma: PrismaService) {}
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

    const where = expenseWhereFromQuery(query);

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
      AND: [expenseWhereFromQuery(query), { status: 'active' }],
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
          date: expenseDateFromYmd(dto.date),
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
    if (dto.date !== undefined) data.date = expenseDateFromYmd(dto.date);

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
}
