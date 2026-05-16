import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProductTransactionQueryDto } from '../dto/product-transaction-query.dto.js';
import { avgPurchaseUnitCostByStoreProductIds } from '../../common/avg-purchase-unit-cost.js';

@Injectable()
export class SaleProductReportService {
  constructor(private readonly prisma: PrismaService) {}
  async getProductTransactions(query: ProductTransactionQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const skip = (page - 1) * limit;

    const start = new Date(query.startDate);
    const end = new Date(query.endDate);

    const saleWhere: Prisma.SaleWhereInput = {
      status: { not: 'RETURNED' },
      createdAt: { gte: start, lte: end },
    };
    if (query.branchId != null && Number.isFinite(query.branchId)) {
      saleWhere.branchId = query.branchId;
    }

    const where: Prisma.SaleItemWhereInput = { sale: saleWhere };

    const [total, items] = await Promise.all([
      this.prisma.saleItem.count({ where }),
      this.prisma.saleItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sale: { createdAt: 'desc' } }, { id: 'desc' }],
        include: {
          sale: { include: { branch: true } },
          storeProduct: {
            include: {
              product: {
                include: { category: true, brand: true },
              },
              productVariant: {
                include: {
                  attributes: {
                    include: {
                      attributeValue: { include: { attribute: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const needFb = items.filter(
      (i) => !i.costPrice || Number(i.costPrice) <= 0,
    );
    const storeProductIds = [...new Set(needFb.map((i) => i.storeProductId))];
    const costByStore =
      storeProductIds.length > 0
        ? await avgPurchaseUnitCostByStoreProductIds(
            this.prisma,
            storeProductIds,
          )
        : new Map<number, number>();

    const saleIds = [...new Set(items.map((i) => i.saleId))];
    const salesForSum =
      saleIds.length > 0
        ? await this.prisma.sale.findMany({
            where: { id: { in: saleIds } },
            select: {
              id: true,
              grandTotal: true,
              items: { select: { total: true } },
            },
          })
        : [];

    const lineSumBySale = new Map<number, Prisma.Decimal>();
    for (const s of salesForSum) {
      let sum = new Prisma.Decimal(0);
      for (const it of s.items) {
        sum = sum.add(it.total);
      }
      lineSumBySale.set(s.id, sum);
    }

    const data = items.map((row) => {
      const sale = row.sale;
      const sp = row.storeProduct;
      const product = sp.product;
      const variant = sp.productVariant;

      const qty = row.quantity;
      const unitPrice = Number(row.unitPrice);
      const lineSub = Number(row.total);
      const costPrice =
        row.costPrice != null && Number(row.costPrice) > 0
          ? Number(row.costPrice)
          : Number(sp.averageCost) > 0
            ? Number(sp.averageCost)
            : (costByStore.get(sp.id) ?? 0);
      const costLine = qty * costPrice;

      const sumLines = lineSumBySale.get(sale.id) ?? new Prisma.Decimal(0);
      const grandTotal = new Prisma.Decimal(sale.grandTotal);
      const lineDec = new Prisma.Decimal(row.total);
      const netRevenueDec = sumLines.gt(0)
        ? grandTotal.mul(lineDec).div(sumLines)
        : lineDec;
      const netRevenue = Number(netRevenueDec);
      const netProfit = netRevenue - costLine;

      const attrs = variant?.attributes?.map((a) => ({
        attribute: { name: a.attributeValue.attribute.name },
        attributeValue: { value: a.attributeValue.value },
      }));

      return {
        id: String(row.id),
        productName: product.name,
        sku: product.sku || variant?.sku || '',
        quantity: qty,
        unitPrice,
        costPrice,
        totalPrice: lineSub,
        lineSubtotal: lineSub,
        netRevenue,
        netProfit,
        saleOrder: {
          id: String(sale.id),
          invoiceNo: sale.invoiceNumber,
          orderNo: sale.invoiceNumber,
          orderType: 'pos',
          orderDate: sale.createdAt.toISOString(),
          grandTotal: Number(sale.grandTotal),
          servicesTotal: 0,
          branch: sale.branch
            ? { id: String(sale.branch.id), name: sale.branch.name }
            : undefined,
        },
        product: {
          sellerCategory: product.category
            ? { id: String(product.category.id), name: product.category.name }
            : null,
          sellerBrand: product.brand
            ? { id: String(product.brand.id), name: product.brand.name }
            : null,
        },
        variant: variant
          ? {
              id: String(variant.id),
              sku: variant.sku,
              attributes: attrs,
            }
          : undefined,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  private extractPurchaseInvoiceFromNote(
    note: string | null | undefined,
  ): string | null {
    if (!note?.trim()) return null;
    const m = note.match(/Invoice:\s*([^\n]+)/i);
    return m?.[1]?.trim() ?? null;
  }

  /** Purchase rows are created in the same transaction as batches; correlate by time window. */
  private async findPurchaseNearBatch(
    batchCreatedAt: Date,
    branchId: number,
    storeProductId: number,
  ) {
    const windowMs = 5 * 60 * 1000;
    const from = new Date(batchCreatedAt.getTime() - windowMs);
    const to = new Date(batchCreatedAt.getTime() + windowMs);
    return this.prisma.purchase.findFirst({
      where: {
        branchId,
        createdAt: { gte: from, lte: to },
        items: { some: { storeProductId } },
      },
      orderBy: { id: 'desc' },
      include: { supplier: true },
    });
  }

  /**
   * Seller-admin style: `{ serialNumber, matchCount, matches[] }` with product/branch/batch,
   * inferred purchase, sale history (current SOLD link), and return history (when persisted).
   */
  async searchBySerial(serialParam: string) {
    const serial = serialParam?.trim();
    if (!serial) {
      throw new BadRequestException('Serial / IMEI is required');
    }

    const row = await this.prisma.serialNumber.findUnique({
      where: { serial },
      include: {
        batch: {
          include: {
            storeProduct: {
              include: {
                product: true,
                productVariant: {
                  include: {
                    attributes: {
                      include: {
                        attributeValue: { include: { attribute: true } },
                      },
                    },
                  },
                },
                branch: true,
              },
            },
          },
        },
        saleItem: {
          include: {
            sale: { include: { customer: true, branch: true } },
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException(`Serial number "${serial}" not found`);
    }

    const sp = row.batch.storeProduct;
    const purchase = await this.findPurchaseNearBatch(
      row.batch.createdAt,
      sp.branchId,
      sp.id,
    );

    const variant = sp.productVariant;
    const attrs =
      variant?.attributes?.map((a) => ({
        attribute: { name: a.attributeValue.attribute.name },
        attributeValue: { value: a.attributeValue.value },
      })) ?? [];

    const saleHistory: Array<{
      id: string;
      invoiceNo: string;
      orderNo: string;
      orderDate: string;
      grandTotal: number;
      paidAmount: number;
      dueAmount: number;
      orderStatus: string;
      paymentStatus: string;
      customer: { id: string; name: string; phone: string | null } | null;
      customerName: string | null;
      branch: { id: string; name: string } | null;
      retailerId: null;
      retailer: null;
    }> = [];

    if (row.status === 'SOLD' && row.saleItem?.sale) {
      const s = row.saleItem.sale;
      const due = Number(s.dueAmount);
      saleHistory.push({
        id: String(s.id),
        invoiceNo: s.invoiceNumber,
        orderNo: s.invoiceNumber,
        orderDate: s.createdAt.toISOString(),
        grandTotal: Number(s.grandTotal),
        paidAmount: Number(s.paidAmount),
        dueAmount: due,
        orderStatus: s.status,
        paymentStatus: due > 0.005 ? 'due' : 'paid',
        customer: s.customer
          ? {
              id: String(s.customer.id),
              name: s.customer.name,
              phone: s.customer.phone ?? null,
            }
          : null,
        customerName: s.customer?.name ?? null,
        branch: s.branch
          ? { id: String(s.branch.id), name: s.branch.name }
          : null,
        retailerId: null,
        retailer: null,
      });
    }

    const invoiceNoFromNote = purchase
      ? this.extractPurchaseInvoiceFromNote(purchase.note)
      : null;

    const productType =
      sp.product.type === 'VARIABLE' ? 'variable' : 'simple';

    const match = {
      id: String(row.id),
      serialNumber: row.serial,
      status: row.status.toLowerCase(),
      soldAt:
        row.status === 'SOLD' && row.saleItem
          ? row.saleItem.sale.createdAt.toISOString()
          : null,
      purchaseId: purchase ? String(purchase.id) : null,
      branchId: String(sp.branchId),
      productId: String(sp.productId),
      variantId:
        sp.productVariantId != null ? String(sp.productVariantId) : null,
      batchId: String(row.batch.id),
      product: {
        id: String(sp.productId),
        name: sp.product.name,
        productType,
      },
      variant: {
        id: variant ? String(variant.id) : String(sp.productId),
        sku: variant?.sku ?? sp.product.sku ?? '—',
        attributes: attrs,
      },
      purchase: purchase
        ? {
            id: String(purchase.id),
            billNo: purchase.referenceNo,
            invoiceNo: invoiceNoFromNote,
            purchaseDate: purchase.createdAt.toISOString(),
            supplier: purchase.supplier
              ? {
                  id: String(purchase.supplier.id),
                  name: purchase.supplier.name,
                  companyName: purchase.supplier.company ?? null,
                  phone: purchase.supplier.phone ?? null,
                }
              : undefined,
          }
        : null,
      branch: { id: String(sp.branch.id), name: sp.branch.name },
      batch: {
        id: String(row.batch.id),
        batchNumber: row.batch.batchNumber,
        batchDate: row.batch.batchDate.toISOString(),
        /** POS IMEI scan: resolve store listing from serial search. */
        storeProduct: {
          id: sp.id,
          productId: sp.productId,
        },
      },
      sellingPrice: Number(sp.sellingPrice),
      saleHistory,
      returnHistory: [] as Array<{
        id: string;
        returnNo: string;
        returnDate: string;
        invoiceNo: string | null;
        branchName: string | null;
        createdAt: string;
      }>,
    };

    return {
      serialNumber: row.serial,
      matchCount: 1,
      matches: [match],
    };
  }
}