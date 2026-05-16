import type { Prisma } from '@prisma/client';

type FinanceCatClient = Pick<
  Prisma.TransactionClient,
  'incomeCategory' | 'expenseCategory'
>;

/** Seller-admin: Other / return gain income category (auto-create if missing). */
export async function resolveReturnGainIncomeCategoryId(
  tx: FinanceCatClient,
): Promise<number> {
  const cats = await tx.incomeCategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  const hit = cats.find(
    (c) =>
      c.name.toLowerCase().includes('other') ||
      c.name.toLowerCase().includes('return'),
  );
  if (hit) return hit.id;
  if (cats[0]) return cats[0].id;

  const created = await tx.incomeCategory.create({
    data: { name: 'Other', isActive: true },
  });
  return created.id;
}

/** Seller-admin: refund / return expense category (auto-create if missing). */
export async function resolveSaleReturnRefundExpenseCategoryId(
  tx: FinanceCatClient,
): Promise<number> {
  const cats = await tx.expenseCategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  const hit = cats.find(
    (c) =>
      c.name.toLowerCase().includes('refund') ||
      c.name.toLowerCase().includes('return'),
  );
  if (hit) return hit.id;
  if (cats[0]) return cats[0].id;

  const created = await tx.expenseCategory.create({
    data: { name: 'Sale Return Refund', isActive: true },
  });
  return created.id;
}
