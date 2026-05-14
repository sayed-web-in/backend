import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { avgPurchaseUnitCostByStoreProductIds } from '../common/avg-purchase-unit-cost.js';

@Injectable()
export class ReportCostingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estimated unit cost per store line (quantity-weighted batch cost, then purchase receipts).
   */
  async avgUnitCostByStoreProduct(
    storeProductIds: number[],
  ): Promise<Map<number, number>> {
    return avgPurchaseUnitCostByStoreProductIds(this.prisma, storeProductIds);
  }

  /** COGS for the period: Σ sale line qty × frozen `costPrice` (seller); legacy lines fall back. */
  async cogsFromSoldItemsForSaleWhere(
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
    const fbMap =
      stillNeedBatch.length > 0
        ? await this.avgUnitCostByStoreProduct(stillNeedBatch)
        : new Map<number, number>();
    let sum = 0;
    for (const it of items) {
      const frozen =
        it.costPrice != null && Number(it.costPrice) > 0
          ? Number(it.costPrice)
          : (spAvgMap.get(it.storeProductId) ?? 0) > 0
            ? (spAvgMap.get(it.storeProductId) ?? 0)
            : (fbMap.get(it.storeProductId) ?? 0);
      sum += it.quantity * frozen;
    }
    return sum;
  }
}
