import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

type BatchPurchaseClient = Pick<PrismaClient, 'batch' | 'purchaseItem'>;

/**
 * Branch-SKU unit cost for costing / TB / reports: Σ batch.totalCost / Σ batch.initialQty
 * (quantity-weighted mean acquisition cost), then purchase-line totals for SKUs with no batches.
 * Does not use `store_product.sellingPrice` (retail).
 */
export async function avgPurchaseUnitCostByStoreProductIds(
  prisma: BatchPurchaseClient,
  storeProductIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (storeProductIds.length === 0) return map;

  const unique = [...new Set(storeProductIds)];

  const batches = await prisma.batch.findMany({
    where: { storeProductId: { in: unique } },
    select: {
      storeProductId: true,
      totalCost: true,
      initialQty: true,
    },
  });

  const sumCost = new Map<number, Prisma.Decimal>();
  const sumQty = new Map<number, number>();

  for (const b of batches) {
    const iq = b.initialQty;
    if (!Number.isFinite(iq) || iq <= 0) continue;
    const tc = new Prisma.Decimal(b.totalCost);
    const sid = b.storeProductId;
    sumCost.set(
      sid,
      (sumCost.get(sid) ?? new Prisma.Decimal(0)).add(tc),
    );
    sumQty.set(sid, (sumQty.get(sid) ?? 0) + iq);
  }

  const missing: number[] = [];
  for (const id of unique) {
    const iq = sumQty.get(id) ?? 0;
    if (iq > 0) {
      const tc = sumCost.get(id)!;
      map.set(id, Number(tc.div(new Prisma.Decimal(iq)).toDecimalPlaces(6)));
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) return map;

  const purchaseSums = await prisma.purchaseItem.groupBy({
    by: ['storeProductId'],
    where: { storeProductId: { in: missing } },
    _sum: { quantity: true, total: true },
  });
  for (const row of purchaseSums) {
    const q = Number(row._sum.quantity ?? 0);
    const t = new Prisma.Decimal(row._sum.total ?? 0);
    if (q > 0 && t.greaterThan(0)) {
      map.set(row.storeProductId, Number(t.div(q).toDecimalPlaces(6)));
    }
  }

  return map;
}
