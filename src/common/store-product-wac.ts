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

/**
 * WAC after stock in (purchase or sale return) — matches seller stock-movement:
 * blends when incoming total cost > 0; zero-cost return keeps prior average unchanged.
 */
export function weightedAverageCostAfterStockIn(
  prevQty: number,
  prevAvgPerUnit: Prisma.Decimal,
  addQty: number,
  addTotalCost: Prisma.Decimal,
): Prisma.Decimal {
  const pq = Math.max(0, prevQty);
  const aq = Math.max(0, addQty);
  const totalQty = pq + aq;
  if (totalQty <= 0) return prevAvgPerUnit;
  if (pq <= 0) {
    return aq > 0 ? addTotalCost.div(aq) : prevAvgPerUnit;
  }
  if (addTotalCost.lte(0)) {
    return prevAvgPerUnit;
  }
  const currentValue = prevAvgPerUnit.mul(pq);
  return currentValue.add(addTotalCost).div(totalQty);
}

/**
 * WAC after stock out (purchase return) — seller stock-movement with negative totalCost:
 * inventory value drops by line cost at return unit cost, not always current WAC × qty.
 */
export function weightedAverageCostAfterStockOut(
  prevQty: number,
  prevAvgPerUnit: Prisma.Decimal,
  removeQty: number,
  removeTotalCost: Prisma.Decimal,
): Prisma.Decimal {
  const pq = Math.max(0, prevQty);
  const rq = Math.max(0, removeQty);
  if (rq <= 0 || pq <= 0) return prevAvgPerUnit;
  const newQty = pq - rq;
  if (newQty <= 0) return prevAvgPerUnit;
  const currentValue = prevAvgPerUnit.mul(pq);
  const costOut = removeTotalCost.gt(0)
    ? removeTotalCost
    : prevAvgPerUnit.mul(rq);
  const newValue = currentValue.sub(costOut);
  if (newValue.lte(0)) return new Prisma.Decimal(0);
  return newValue.div(newQty);
}
