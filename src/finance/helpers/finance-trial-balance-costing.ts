import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { avgPurchaseUnitCostByStoreProductIds } from '../../common/avg-purchase-unit-cost.js';
import { completedSaleReturnWhere } from '../../common/sale-return-seller.js';

export function tbAvgUnitCostByStoreProduct(
  prisma: PrismaService,
  storeProductIds: number[],
) {
  return avgPurchaseUnitCostByStoreProductIds(prisma, storeProductIds);
}

export async function tbCogsFromSoldItems(
  prisma: PrismaService,
  saleWhere: Prisma.SaleWhereInput,
): Promise<number> {
  const items = await prisma.saleItem.findMany({
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
      ? await prisma.storeProduct.findMany({
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
  const costMap = await tbAvgUnitCostByStoreProduct(prisma, stillNeedBatch);
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
export async function tbReturnCogs(
  prisma: PrismaService,
  saleReturnWhere: Prisma.SaleReturnWhereInput,
): Promise<number> {
  const items = await prisma.saleReturnItem.findMany({
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
      ? await prisma.storeProduct.findMany({
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
  const costMap = await tbAvgUnitCostByStoreProduct(prisma, stillNeedBatch);
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
