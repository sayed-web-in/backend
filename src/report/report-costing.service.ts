import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ReportCostingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estimated unit cost per store line (avg batch purchaseCost, then avg purchase unitCost).
   * Matches product-transaction / POS cost lines when batches exist.
   */
  async avgUnitCostByStoreProduct(
    storeProductIds: number[],
  ): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (storeProductIds.length === 0) return map;

    const batchAvgs = await this.prisma.batch.groupBy({
      by: ['storeProductId'],
      where: { storeProductId: { in: storeProductIds } },
      _avg: { purchaseCost: true },
    });
    for (const row of batchAvgs) {
      map.set(row.storeProductId, Number(row._avg.purchaseCost ?? 0));
    }

    const missing = storeProductIds.filter((id) => (map.get(id) ?? 0) <= 0);
    if (missing.length === 0) return map;

    const purchaseAvgs = await this.prisma.purchaseItem.groupBy({
      by: ['storeProductId'],
      where: { storeProductId: { in: missing } },
      _avg: { unitCost: true },
    });
    for (const row of purchaseAvgs) {
      const v = Number(row._avg.unitCost ?? 0);
      if (v > 0) map.set(row.storeProductId, v);
    }
    return map;
  }

  /** COGS for the period: Σ sale line qty × unit cost (not “purchases in period”). */
  async cogsFromSoldItemsForSaleWhere(
    saleWhere: Prisma.SaleWhereInput,
  ): Promise<number> {
    const items = await this.prisma.saleItem.findMany({
      where: { sale: saleWhere },
      select: { storeProductId: true, quantity: true },
    });
    if (items.length === 0) return 0;
    const storeIds = [...new Set(items.map((i) => i.storeProductId))];
    const costMap = await this.avgUnitCostByStoreProduct(storeIds);
    let sum = 0;
    for (const it of items) {
      sum += it.quantity * (costMap.get(it.storeProductId) ?? 0);
    }
    return sum;
  }
}
