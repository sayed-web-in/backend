import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateIncomeCategoryDto } from '../dto/create-income-category.dto.js';
import { CreateIncomeDto } from '../dto/create-income.dto.js';
import { FinanceQueryDto } from '../dto/finance-query.dto.js';
import { paginate } from '../../common/pagination.dto.js';
import { incomeWhereFromQuery } from '../helpers/finance-query.filters.js';

@Injectable()
export class FinanceIncomeService {
  constructor(private readonly prisma: PrismaService) {}
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

    const where = incomeWhereFromQuery(query);

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
      AND: [incomeWhereFromQuery(query), { status: 'active' }],
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

}
