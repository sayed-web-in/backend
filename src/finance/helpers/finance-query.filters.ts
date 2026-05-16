import { bdDayEndUtc, bdDayStartUtc } from '../../common/bd-time.js';
import type { FinanceQueryDto } from '../dto/finance-query.dto.js';

  export function expenseWhereFromQuery(query: FinanceQueryDto) {
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

  export function expenseDateFromYmd(d?: string): Date {
    if (!d) return new Date();
    return bdDayStartUtc(d.slice(0, 10));
  }

  export function incomeWhereFromQuery(query: FinanceQueryDto) {
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
