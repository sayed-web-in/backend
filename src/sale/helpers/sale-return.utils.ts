import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateSaleReturnDto } from '../dto/create-sale-return.dto.js';

export function composeSaleReturnReason(dto: CreateSaleReturnDto): string | null {
  const blocks: string[] = [];
  if (dto.returnDate?.trim()) blocks.push(`Return date: ${dto.returnDate.trim()}`);
  if (dto.reference?.trim()) blocks.push(`Reference: ${dto.reference.trim()}`);
  if (dto.responsiblePerson?.trim()) {
    blocks.push(`Responsible: ${dto.responsiblePerson.trim()}`);
  }
  if (dto.notes?.trim()) blocks.push(`Notes: ${dto.notes.trim()}`);
  if (dto.reason?.trim()) blocks.push(dto.reason.trim());
  const s = blocks.join('\n').trim();
  return s.length ? s : null;
}

export function lineDamageAmount(
  lineTotal: Prisma.Decimal,
  type?: string,
  rawVal?: number,
): Prisma.Decimal {
  if (!type || type === 'none' || rawVal == null || rawVal <= 0) {
    return new Prisma.Decimal(0);
  }
  const val = new Prisma.Decimal(rawVal);
  if (type === 'percentage') {
    const p = Prisma.Decimal.min(val, new Prisma.Decimal(100));
    return lineTotal.mul(p).div(new Prisma.Decimal(100));
  }
  if (type === 'fixed') {
    return Prisma.Decimal.min(lineTotal, val);
  }
  return new Prisma.Decimal(0);
}

export function resolveSaleItemForReturn(
  sale: { items: { id: number; storeProductId: number; quantity: number }[] },
  dtoItem: { saleItemId?: number; storeProductId: number },
) {
  if (dtoItem.saleItemId != null) {
    const si = sale.items.find(
      (i) => i.id === dtoItem.saleItemId && i.storeProductId === dtoItem.storeProductId,
    );
    if (!si) {
      throw new BadRequestException(
        `saleItemId ${dtoItem.saleItemId} does not match this sale / store product`,
      );
    }
    return si;
  }
  const matches = sale.items.filter((i) => i.storeProductId === dtoItem.storeProductId);
  if (matches.length === 1) return matches[0];
  throw new BadRequestException(
    `saleItemId is required when multiple invoice lines use store product #${dtoItem.storeProductId}`,
  );
}

export function priorReturnedForSaleLine(
  saleItems: { id: number; storeProductId: number; quantity: number }[],
  returnRows: { saleItemId: number | null; storeProductId: number; quantity: number }[],
  si: { id: number; storeProductId: number },
): number {
  const sameSp = saleItems.filter((x) => x.storeProductId === si.storeProductId);
  let returned = 0;
  for (const r of returnRows) {
    if (r.saleItemId === si.id) returned += r.quantity;
    else if (
      r.saleItemId == null &&
      r.storeProductId === si.storeProductId &&
      sameSp.length === 1
    ) {
      returned += r.quantity;
    }
  }
  return returned;
}

export function parseReturnDate(raw?: string): Date {
  if (!raw?.trim()) return new Date();
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
