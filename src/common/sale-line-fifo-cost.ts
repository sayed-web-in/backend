import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

type Tx = Prisma.TransactionClient;

/**
 * FIFO: consume `quantity` units from oldest batches first, update available/sold qty,
 * return weighted-average unit cost for this sale line (seller-style frozen COGS basis).
 */
export async function fifoConsumeBatchesForSaleLine(
  tx: Tx,
  storeProductId: number,
  quantity: number,
  fallbackPerUnit: Prisma.Decimal,
): Promise<Prisma.Decimal> {
  if (quantity <= 0) {
    return new Prisma.Decimal(0);
  }

  const batches = await tx.batch.findMany({
    where: { storeProductId, availableQty: { gt: 0 } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      availableQty: true,
      initialQty: true,
      totalCost: true,
      purchaseCost: true,
    },
  });

  let need = quantity;
  let totalVal = new Prisma.Decimal(0);
  let taken = 0;

  for (const b of batches) {
    if (need <= 0) break;
    const take = Math.min(need, b.availableQty);
    const initial = b.initialQty;
    const unit =
      initial > 0
        ? D(b.totalCost).div(D(initial))
        : D(b.purchaseCost);
    const effective = unit.greaterThan(0) ? unit : fallbackPerUnit;
    totalVal = totalVal.add(effective.mul(D(take)));
    await tx.batch.update({
      where: { id: b.id },
      data: {
        availableQty: { decrement: take },
        soldQty: { increment: take },
      },
    });
    taken += take;
    need -= take;
  }

  if (taken < quantity) {
    const remain = quantity - taken;
    totalVal = totalVal.add(fallbackPerUnit.mul(D(remain)));
  }

  return totalVal.div(D(quantity));
}

/**
 * IMEI: one cost per serial from its batch; decrement each batch; return line average unit cost.
 */
export async function imeiConsumeBatchesForSaleLine(
  tx: Tx,
  serials: string[],
  storeProductId: number,
  fallbackPerUnit: Prisma.Decimal,
): Promise<Prisma.Decimal> {
  const cleaned = serials.map((s) => String(s).trim()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new BadRequestException(
      'IMEI-tracked lines require serial numbers for each unit sold',
    );
  }
  if (new Set(cleaned).size !== cleaned.length) {
    throw new BadRequestException('Duplicate IMEI/serial in sale line');
  }

  const rows = await tx.serialNumber.findMany({
    where: {
      serial: { in: cleaned },
      batch: { storeProductId },
    },
    include: {
      batch: {
        select: {
          id: true,
          storeProductId: true,
          availableQty: true,
          initialQty: true,
          totalCost: true,
          purchaseCost: true,
        },
      },
    },
  });

  if (rows.length !== cleaned.length) {
    throw new BadRequestException(
      'One or more IMEI/serial numbers were not found for this product',
    );
  }

  let totalVal = new Prisma.Decimal(0);
  for (const row of rows) {
    if (row.status !== 'IN_STOCK') {
      throw new BadRequestException(
        `IMEI/serial ${row.serial} is not available (status: ${row.status})`,
      );
    }
    const b = row.batch;
    if (b.storeProductId !== storeProductId) {
      throw new BadRequestException(
        `IMEI/serial ${row.serial} does not belong to this store listing`,
      );
    }
    if (b.availableQty <= 0) {
      throw new BadRequestException(
        `IMEI/serial ${row.serial} has no available stock in its batch`,
      );
    }
    const initial = b.initialQty;
    const unit =
      initial > 0
        ? D(b.totalCost).div(D(initial))
        : D(b.purchaseCost);
    const effective = unit.greaterThan(0) ? unit : fallbackPerUnit;
    totalVal = totalVal.add(effective);

    await tx.batch.update({
      where: { id: b.id },
      data: {
        availableQty: { decrement: 1 },
        soldQty: { increment: 1 },
      },
    });
  }

  const n = cleaned.length;
  if (n <= 0) return new Prisma.Decimal(0);
  return totalVal.div(D(n));
}
