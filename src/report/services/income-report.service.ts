import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReportQueryDto } from '../dto/report-query.dto.js';
import {
  financeLinePagination,
  financeReportDateWhere,
} from '../helpers/report-query.utils.js';

@Injectable()
export class IncomeReportService {
  constructor(private readonly prisma: PrismaService) {}

  async incomeReport(query: ReportQueryDto) {
    const baseWhere: Prisma.IncomeWhereInput = {
      status: 'active',
      ...financeReportDateWhere(query),
      ...(query.branchId != null && Number.isFinite(query.branchId)
        ? { branchId: Math.floor(Number(query.branchId)) }
        : {}),
      ...(query.categoryId != null ? { categoryId: query.categoryId } : {}),
    };

    const { limit, page, skip } = financeLinePagination(query);

    const [
      byCategoryRows,
      dailyRows,
      totalAgg,
      minMaxAgg,
      totalRows,
      incomeLines,
    ] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['categoryId'],
        where: baseWhere,
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
      this.prisma.income.groupBy({
        by: ['date'],
        where: baseWhere,
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.income.aggregate({
        where: baseWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.income.aggregate({
        where: baseWhere,
        _max: { amount: true },
        _min: { amount: true },
      }),
      this.prisma.income.count({ where: baseWhere }),
      this.prisma.income.findMany({
        where: baseWhere,
        orderBy: { date: 'desc' },
        skip,
        take: limit,
        include: {
          category: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          account: { select: { id: true, name: true, type: true } },
        },
      }),
    ]);

    const incCatIds = byCategoryRows.map((r) => r.categoryId);
    const incCats =
      incCatIds.length > 0
        ? await this.prisma.incomeCategory.findMany({
            where: { id: { in: incCatIds } },
            select: { id: true, name: true },
          })
        : [];
    const icMap = new Map(incCats.map((c) => [c.id, c.name]));
    const byCategory = byCategoryRows.map((r) => ({
      categoryId: r.categoryId,
      categoryName: icMap.get(r.categoryId) ?? 'Unknown',
      totalAmount: Number(r._sum.amount ?? 0),
      count: r._count.id,
    }));

    const dailyBreakdown = (() => {
      const map = new Map<
        string,
        { date: string; total: number; count: number }
      >();
      for (const row of dailyRows) {
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
    })();

    const totalIncome = Number(totalAgg._sum.amount ?? 0);
    const totalCount = totalAgg._count.id;
    const totalCategories = byCategory.length;
    const lastPage = Math.max(1, Math.ceil(totalRows / limit));

    const items = incomeLines.map((e) => {
      const descParts = [e.name, e.note].filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0,
      );
      return {
        id: e.id,
        reference: e.reference ?? null,
        categoryName: e.category.name,
        description: descParts.length > 0 ? descParts.join(' — ') : null,
        amount: Number(e.amount),
        accountName: e.account?.name ?? null,
        accountType: e.account?.type ?? null,
        branchName: e.branch?.name ?? null,
        date: e.date.toISOString(),
        status: e.status,
      };
    });

    const incomes = byCategory.map((b) => ({
      category: b.categoryName,
      count: b.count,
      amount: b.totalAmount,
    }));

    return {
      totalIncome,
      totalCount,
      totalCategories,
      summary: {
        totalIncome,
        totalCount,
        totalCategories,
        highestAmount: Number(minMaxAgg._max.amount ?? 0),
        lowestAmount: Number(minMaxAgg._min.amount ?? 0),
      },
      byCategory,
      dailyBreakdown,
      incomes,
      items,
      total: totalRows,
      page,
      lastPage,
      totalPages: lastPage,
      limit,
    };
  }
}
