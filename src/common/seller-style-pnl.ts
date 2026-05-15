import {
  Prisma,
  PurchaseStatus,
  SupplierTransactionType,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { completedSaleReturnWhere } from './sale-return-seller.js';

export type SellerStylePnlRevenue = {
  productSales: number;
  serviceIncome: number;
  otherIncome: number;
  refundTotal: number;
  returnGainTotal: number;
  totalRevenue: number;
};

/** Operating expenses for TB / P&amp;L (excludes salary-advance refs and sale-return refund expenses). */
export function sellerStyleExpenseWhere(
  base: Prisma.ExpenseWhereInput = {},
): Prisma.ExpenseWhereInput {
  return {
    ...base,
    status: 'active',
    AND: [
      ...(Array.isArray(base.AND) ? base.AND : base.AND ? [base.AND] : []),
      {
        OR: [
          { reference: { equals: null } },
          { NOT: { reference: { startsWith: 'advance-salary:' } } },
        ],
      },
      { NOT: { name: { contains: 'Sale Return Refund' } } },
    ],
  };
}

function splitIncomeRows(
  rows: Array<{
    amount: Prisma.Decimal;
    name: string | null;
    category: { name: string } | null;
  }>,
): { serviceIncome: number; otherIncome: number } {
  let serviceIncome = 0;
  let otherIncome = 0;
  for (const inc of rows) {
    const incName = (inc.name || '').toLowerCase();
    const cat = (inc.category?.name || '').toLowerCase();
    const amt = Number(inc.amount);
    if (incName.startsWith('service income') || cat.includes('service')) {
      serviceIncome += amt;
    } else {
      otherIncome += amt;
    }
  }
  return { serviceIncome, otherIncome };
}

/**
 * Seller-admin trial balance / P&amp;L revenue:
 * product sales (grandTotal − servicesTotal) + service &amp; other income − refunds + return gain.
 */
export async function sellerStylePnlRevenue(
  prisma: PrismaService,
  opts: {
    saleWhere: Prisma.SaleWhereInput;
    incomeWhere?: Prisma.IncomeWhereInput;
    saleReturnWhere?: Prisma.SaleReturnWhereInput;
  },
): Promise<SellerStylePnlRevenue> {
  const incomeWhere: Prisma.IncomeWhereInput = {
    status: 'active',
    ...opts.incomeWhere,
  };

  const [salesAgg, incomes, returnAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: opts.saleWhere,
      _sum: { grandTotal: true, servicesTotal: true },
    }),
    prisma.income.findMany({
      where: incomeWhere,
      select: {
        amount: true,
        name: true,
        category: { select: { name: true } },
      },
    }),
    prisma.saleReturn.aggregate({
      where: completedSaleReturnWhere(opts.saleReturnWhere ?? {}),
      _sum: { refundAmount: true },
    }),
  ]);

  const productSales =
    Number(salesAgg._sum.grandTotal ?? 0) -
    Number(salesAgg._sum.servicesTotal ?? 0);
  const { serviceIncome, otherIncome } = splitIncomeRows(incomes);
  const refundTotal = Number(returnAgg._sum.refundAmount ?? 0);
  /** Return gain is posted as Income on complete (seller-admin); not added again here. */
  const returnGainTotal = 0;
  const totalRevenue =
    productSales + serviceIncome + otherIncome - refundTotal;

  return {
    productSales,
    serviceIncome,
    otherIncome,
    refundTotal,
    returnGainTotal,
    totalRevenue,
  };
}

/** Legacy POS sales with servicesTotal but no Service Income row yet (pre-migration). */
export async function legacyPosServiceIncomeGap(
  prisma: PrismaService,
  saleWhere: Prisma.SaleWhereInput,
): Promise<number> {
  const sales = await prisma.sale.findMany({
    where: {
      ...saleWhere,
      servicesTotal: { gt: 0 },
    },
    select: { invoiceNumber: true, servicesTotal: true },
  });
  if (sales.length === 0) return 0;

  const refs = sales.map((s) => s.invoiceNumber);
  const posted = await prisma.income.findMany({
    where: {
      status: 'active',
      reference: { in: refs },
      name: { startsWith: 'Service Income' },
    },
    select: { reference: true, amount: true },
  });
  const postedByRef = new Map<string, number>();
  for (const row of posted) {
    if (!row.reference) continue;
    postedByRef.set(
      row.reference,
      (postedByRef.get(row.reference) ?? 0) + Number(row.amount),
    );
  }

  let gap = 0;
  for (const s of sales) {
    const svc = Number(s.servicesTotal);
    const postedAmt = postedByRef.get(s.invoiceNumber) ?? 0;
    if (svc > postedAmt + 0.009) gap += svc - postedAmt;
  }
  return gap;
}

export async function sellerStyleSupplierPayable(
  prisma: PrismaService,
  branchId?: number,
): Promise<number> {
  const purchaseWhere: Prisma.PurchaseWhereInput = {
    dueAmount: { gt: 0 },
    status: { not: PurchaseStatus.RETURNED },
  };
  if (branchId != null) purchaseWhere.branchId = branchId;

  let supplierIdsForTx: number[] | undefined;
  if (branchId != null) {
    const rows = await prisma.purchase.findMany({
      where: { branchId, supplierId: { not: null } },
      select: { supplierId: true },
      distinct: ['supplierId'],
    });
    supplierIdsForTx = rows
      .map((r) => r.supplierId)
      .filter((id): id is number => id != null);
    if (supplierIdsForTx.length === 0) return 0;
  }

  const supplierTxWhere: Prisma.SupplierTransactionWhereInput =
    supplierIdsForTx != null
      ? { supplierId: { in: supplierIdsForTx } }
      : {};

  const [purchaseDueAgg, customDueAgg, customPaidAgg] = await Promise.all([
    prisma.purchase.aggregate({
      where: purchaseWhere,
      _sum: { dueAmount: true },
    }),
    prisma.supplierTransaction.aggregate({
      where: { ...supplierTxWhere, type: SupplierTransactionType.DUE },
      _sum: { amount: true },
    }),
    prisma.supplierTransaction.aggregate({
      where: {
        ...supplierTxWhere,
        type: SupplierTransactionType.PAYMENT,
        purchaseId: null,
      },
      _sum: { amount: true },
    }),
  ]);

  const purchaseDue = Number(purchaseDueAgg._sum.dueAmount ?? 0);
  const customOutstanding = Math.max(
    0,
    Number(customDueAgg._sum.amount ?? 0) -
      Number(customPaidAgg._sum.amount ?? 0),
  );
  return purchaseDue + customOutstanding;
}
