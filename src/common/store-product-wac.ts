import { Prisma } from '@prisma/client';

/** Weighted average cost after adding stock (seller `averageCost` style). */
export function weightedAverageCostAfterPurchase(
  prevQty: number,
  prevAvgPerUnit: Prisma.Decimal,
  addQty: number,
  addUnitCost: Prisma.Decimal,
): Prisma.Decimal {
  const pq = new Prisma.Decimal(Math.max(0, prevQty));
  const aq = new Prisma.Decimal(Math.max(0, addQty));
  const totalQty = pq.add(aq);
  if (totalQty.lte(0)) {
    return addUnitCost;
  }
  if (pq.lte(0)) {
    return addUnitCost;
  }
  return prevAvgPerUnit.mul(pq).add(addUnitCost.mul(aq)).div(totalQty);
}
