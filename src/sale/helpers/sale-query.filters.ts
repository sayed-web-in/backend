import { bdDayEndUtc, bdDayStartUtc } from '../../common/bd-time.js';
import type { SaleQueryDto } from '../dto/sale-query.dto.js';
import type { SaleReturnQueryDto } from '../dto/sale-return-query.dto.js';

export function saleWhereFromDto(
  query: Pick<
    SaleQueryDto,
    'branchId' | 'customerId' | 'status' | 'search' | 'dateFrom' | 'dateTo'
  >,
): Record<string, unknown> {
  const { branchId, customerId, status, search, dateFrom, dateTo } = query;
  const where: Record<string, unknown> = {};
  if (branchId) where.branchId = branchId;
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search } },
      { customer: { name: { contains: search } } },
      { customer: { phone: { contains: search } } },
    ];
  }
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) {
      (where.createdAt as Record<string, Date>).gte = bdDayStartUtc(dateFrom);
    }
    if (dateTo) {
      (where.createdAt as Record<string, Date>).lte = bdDayEndUtc(dateTo);
    }
  }
  return where;
}

export function saleReturnWhereFromDto(
  query: Pick<SaleReturnQueryDto, 'branchId' | 'search' | 'dateFrom' | 'dateTo'>,
): Record<string, unknown> {
  const { branchId, search, dateFrom, dateTo } = query;
  const parts: Record<string, unknown>[] = [];
  if (branchId) {
    parts.push({ sale: { branchId } });
  }
  if (search) {
    parts.push({
      OR: [
        { reason: { contains: search } },
        { sale: { invoiceNumber: { contains: search } } },
      ],
    });
  }
  if (dateFrom || dateTo) {
    const range: Record<string, Date> = {};
    if (dateFrom) range.gte = bdDayStartUtc(dateFrom);
    if (dateTo) range.lte = bdDayEndUtc(dateTo);
    parts.push({ createdAt: range });
  }
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { AND: parts };
}
