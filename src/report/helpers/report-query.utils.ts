import { Prisma, SaleStatus } from '@prisma/client';
import { bdDayEndUtc, bdDayStartUtc } from '../../common/bd-time.js';
import type { ReportQueryDto } from '../dto/report-query.dto.js';

export function dateRange(query: ReportQueryDto) {
  const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
  if (query.dateFrom || query.dateTo) {
    where.createdAt = {};
    if (query.dateFrom) where.createdAt.gte = bdDayStartUtc(query.dateFrom);
    if (query.dateTo) where.createdAt.lte = bdDayEndUtc(query.dateTo);
  }
  return where;
}

/** `dateFrom`/`dateTo` with seller-style `startDate`/`endDate` aliases. */
export function salesReportDateWhere(query: ReportQueryDto) {
  const from = query.dateFrom ?? query.startDate;
  const to = query.dateTo ?? query.endDate;
  const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = bdDayStartUtc(from);
    if (to) where.createdAt.lte = bdDayEndUtc(to);
  }
  return where;
}

export function salesReportSaleWhere(query: ReportQueryDto): Prisma.SaleWhereInput {
  const dateWhere = salesReportDateWhere(query);
  const EPS = 0.01;
  const where: Prisma.SaleWhereInput = {
    ...dateWhere,
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.customerId != null ? { customerId: query.customerId } : {}),
  };
  const ps = query.paymentStatus;
  if (ps === 'paid') {
    where.dueAmount = { lte: EPS };
  } else if (ps === 'partial') {
    where.paidAmount = { gt: EPS };
    where.dueAmount = { gt: EPS };
  } else if (ps === 'due') {
    where.dueAmount = { gt: EPS };
    where.paidAmount = { lte: EPS };
  }
  return where;
}

export function purchaseReportPurchaseWhere(
  query: ReportQueryDto,
): Prisma.PurchaseWhereInput {
  const dateWhere = salesReportDateWhere(query);
  const EPS = 0.01;
  const where: Prisma.PurchaseWhereInput = {
    ...dateWhere,
    ...(query.branchId ? { branchId: query.branchId } : {}),
  };
  const ps = query.paymentStatus;
  if (ps === 'paid') {
    where.dueAmount = { lte: EPS };
  } else if (ps === 'partial') {
    where.paidAmount = { gt: EPS };
    where.dueAmount = { gt: EPS };
  } else if (ps === 'due') {
    where.dueAmount = { gt: EPS };
    where.paidAmount = { lte: EPS };
  }
  return where;
}

export function derivePaymentStatus(
  paid: number,
  due: number,
  grand: number,
): 'paid' | 'partial' | 'due' {
  const eps = 0.01;
  if (due <= eps && paid + eps >= grand) return 'paid';
  if (due > eps && paid > eps) return 'partial';
  if (due > eps) return 'due';
  return 'paid';
}

export function saleOrderStatusLabel(status: SaleStatus): string {
  const map: Record<SaleStatus, string> = {
    [SaleStatus.COMPLETED]: 'completed',
    [SaleStatus.PAY_LATER]: 'pay_later',
    [SaleStatus.RETURNED]: 'returned',
    [SaleStatus.PARTIAL_RETURN]: 'partial_return',
  };
  return map[status] ?? String(status).toLowerCase();
}

export function dateFieldRange(field: string, query: ReportQueryDto) {
  const where: Record<string, { gte?: Date; lte?: Date }> = {};
  if (query.dateFrom || query.dateTo) {
    where[field] = {};
    if (query.dateFrom) where[field].gte = bdDayStartUtc(query.dateFrom);
    if (query.dateTo) where[field].lte = bdDayEndUtc(query.dateTo);
  }
  return where;
}

/** Expense / income `date` with `startDate` / `endDate` aliases (same as sales date aliases). */
export function financeReportDateWhere(
  query: ReportQueryDto,
): { date?: { gte?: Date; lte?: Date } } {
  const from = query.dateFrom ?? query.startDate;
  const to = query.dateTo ?? query.endDate;
  if (!from && !to) return {};
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = bdDayStartUtc(from);
  if (to) range.lte = bdDayEndUtc(to);
  return { date: range };
}

export function financeLinePagination(query: ReportQueryDto) {
  const rawLimit = query.limit ?? 25;
  const limit = Math.min(2000, Math.max(1, Number(rawLimit) || 25));
  const page = Math.max(1, query.page ?? 1);
  const skip = (page - 1) * limit;
  return { limit, page, skip };
}

export function previousPeriodRange(query: ReportQueryDto) {
  if (!query.dateFrom || !query.dateTo) return null;
  const from = bdDayStartUtc(query.dateFrom);
  const to = bdDayEndUtc(query.dateTo);
  const diff = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - diff);
  return { gte: prevFrom, lte: prevTo };
}
