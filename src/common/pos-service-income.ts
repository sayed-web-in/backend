import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

async function resolveServiceIncomeCategoryId(tx: Tx): Promise<number> {
  const cats = await tx.incomeCategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  const service = cats.find((c) => c.name.toLowerCase().includes('service'));
  if (service) return service.id;
  const sales = cats.find((c) => c.name.toLowerCase().includes('sales'));
  if (sales) return sales.id;
  if (cats[0]) return cats[0].id;
  const created = await tx.incomeCategory.create({
    data: { name: 'Service', isActive: true },
    select: { id: true },
  });
  return created.id;
}

/**
 * Seller-admin POS: `Service Income - {invoice}` income row for P&amp;L only.
 * Cash was already credited on sale payment — do not post a second account CREDIT.
 */
export async function postPosServiceIncomeIfNeeded(
  tx: Tx,
  params: {
    servicesTotal: Prisma.Decimal;
    branchId: number;
    invoiceNumber: string;
    customerName?: string | null;
    saleDate?: Date;
    /** For display / category linkage only; no ledger movement. */
    paymentAccountId?: number | null;
  },
): Promise<void> {
  if (params.servicesTotal.lte(0)) return;

  const existing = await tx.income.findFirst({
    where: {
      reference: params.invoiceNumber,
      name: { startsWith: 'Service Income' },
      status: 'active',
    },
    select: { id: true },
  });
  if (existing) return;

  const categoryId = await resolveServiceIncomeCategoryId(tx);
  const amount = params.servicesTotal.toDecimalPlaces(2);
  const customerSuffix = params.customerName?.trim()
    ? ` (${params.customerName.trim()})`
    : '';

  await tx.income.create({
    data: {
      name: `Service Income - ${params.invoiceNumber}`,
      amount,
      branchId: params.branchId,
      categoryId,
      accountId: params.paymentAccountId ?? null,
      reference: params.invoiceNumber,
      note: `Service Revenue - ${params.invoiceNumber}${customerSuffix}`,
      status: 'active',
      date: params.saleDate ?? new Date(),
    },
  });
}
