import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Seller-admin counts only posted returns in P&L / TB. */
export const COMPLETED_SALE_RETURN_STATUSES = ['completed', 'approved'] as const;

export function completedSaleReturnWhere(
  base: Prisma.SaleReturnWhereInput = {},
): Prisma.SaleReturnWhereInput {
  const statusFilter = { in: [...COMPLETED_SALE_RETURN_STATUSES] };
  if (base.status !== undefined) {
    return { AND: [base, { status: statusFilter }] };
  }
  return { ...base, status: statusFilter };
}

export type ReturnLineCogsInput = {
  quantity: number;
  storeProductId: number;
  saleItemId: number | null;
  saleItem: { costPrice: Prisma.Decimal } | null;
};

/** Frozen sale line cost × qty (seller return COGS). */
export async function returnCogsForLines(
  prisma: PrismaService,
  lines: ReturnLineCogsInput[],
): Promise<number> {
  if (lines.length === 0) return 0;
  const needFallback = lines.filter(
    (i) =>
      !i.saleItem ||
      i.saleItem.costPrice == null ||
      Number(i.saleItem.costPrice) <= 0,
  );
  const storeIds = [...new Set(needFallback.map((i) => i.storeProductId))];
  const spRows =
    storeIds.length > 0
      ? await prisma.storeProduct.findMany({
          where: { id: { in: storeIds } },
          select: { id: true, averageCost: true },
        })
      : [];
  const spAvgMap = new Map(
    spRows.map((r) => [r.id, Number(r.averageCost)]),
  );
  let sum = 0;
  for (const it of lines) {
    const uc =
      it.saleItem &&
      it.saleItem.costPrice != null &&
      Number(it.saleItem.costPrice) > 0
        ? Number(it.saleItem.costPrice)
        : (spAvgMap.get(it.storeProductId) ?? 0);
    sum += it.quantity * uc;
  }
  return Math.round(sum * 100) / 100;
}

/** Per-return then sum — seller P&L `returnGain` column. */
export async function sellerStyleReturnGainTotal(
  prisma: PrismaService,
  where: Prisma.SaleReturnWhereInput,
): Promise<number> {
  const returns = await prisma.saleReturn.findMany({
    where: completedSaleReturnWhere(where),
    select: {
      id: true,
      refundAmount: true,
      items: {
        select: {
          quantity: true,
          storeProductId: true,
          saleItemId: true,
          saleItem: { select: { costPrice: true } },
        },
      },
    },
  });
  let total = 0;
  for (const r of returns) {
    const cogs = await returnCogsForLines(prisma, r.items);
    const refund = Number(r.refundAmount ?? 0);
    total += Math.max(0, Math.round((cogs - refund) * 100) / 100);
  }
  return Math.round(total * 100) / 100;
}

/** Cumulative cash refund paid in this request (seller `refundPaidNow`). */
export function sellerRefundPaidNow(
  status: string,
  storedRefundAmount: number,
  refundBase: number,
  nextRefundAmount: number,
): { prevPaidSoFar: number; nextPaidSoFar: number; refundPaidNow: number } {
  const base = Math.max(0, refundBase);
  const prevStored = Math.max(0, storedRefundAmount);
  const prevPaidSoFar =
    status === 'pending' && prevStored + 0.005 >= base
      ? 0
      : Math.min(prevStored, base);
  const nextPaidSoFar = Math.min(Math.max(0, nextRefundAmount), base);
  const refundPaidNow = Math.max(
    0,
    Math.round((nextPaidSoFar - prevPaidSoFar) * 100) / 100,
  );
  return { prevPaidSoFar, nextPaidSoFar, refundPaidNow };
}
