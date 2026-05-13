import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReportQueryDto } from '../dto/report-query.dto.js';

@Injectable()
export class StockReportService {
  constructor(private readonly prisma: PrismaService) {}

  async stockReport(query: ReportQueryDto) {
    const productWhere: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      isArchived: false,
    };
    if (query.categoryId != null) productWhere.categoryId = query.categoryId;
    if (query.subCategoryId != null) productWhere.subCategoryId = query.subCategoryId;
    if (query.brandId != null) productWhere.brandId = query.brandId;

    const storeWhere: Prisma.StoreProductWhereInput = {
      isActive: true,
      product: productWhere,
      ...(query.branchId != null && Number.isFinite(query.branchId)
        ? { branchId: Math.floor(Number(query.branchId)) }
        : {}),
    };

    const rawLimit = query.limit ?? 25;
    const limit = Math.min(2000, Math.max(1, Number(rawLimit) || 25));
    const page = Math.max(1, query.page ?? 1);
    const skip = (page - 1) * limit;

    const minimal = await this.prisma.storeProduct.findMany({
      where: storeWhere,
      select: {
        productId: true,
        quantity: true,
        sellingPrice: true,
        quantityAlert: true,
      },
    });

    let totalQty = 0;
    let totalValue = 0;
    const pidSet = new Set<number>();
    let lowStockCount = 0;
    for (const m of minimal) {
      pidSet.add(m.productId);
      totalQty += m.quantity;
      totalValue += m.quantity * Number(m.sellingPrice);
      if (m.quantity <= m.quantityAlert) lowStockCount += 1;
    }
    const totalProducts = pidSet.size;

    const [soldAgg, pageRows] = await Promise.all([
      this.prisma.batch.aggregate({
        where: { storeProduct: storeWhere },
        _sum: { soldQty: true },
      }),
      this.prisma.storeProduct.findMany({
        where: storeWhere,
        orderBy: [{ product: { name: 'asc' } }, { branchId: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              images: {
                take: 1,
                orderBy: { sortOrder: 'asc' },
                select: { url: true },
              },
            },
          },
          productVariant: {
            select: {
              sku: true,
              image: true,
              attributes: {
                include: {
                  attributeValue: {
                    select: {
                      value: true,
                      attribute: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
          branch: { select: { id: true, name: true } },
          batches: { select: { soldQty: true } },
        },
      }),
    ]);

    const totalRows = minimal.length;
    const lastPage = Math.max(1, Math.ceil(totalRows / limit));
    const totalSoldAll = Number(soldAgg._sum.soldQty ?? 0);

    const items = pageRows.map((sp) => {
      const soldStock = sp.batches.reduce((s, b) => s + b.soldQty, 0);
      const variant = sp.productVariant
        ? sp.productVariant.attributes
            .map(
              (a) =>
                `${a.attributeValue.attribute.name}: ${a.attributeValue.value}`,
            )
            .join(', ')
        : null;
      const sku = sp.productVariant?.sku ?? sp.product.sku ?? '—';
      const img =
        (sp.productVariant?.image && sp.productVariant.image.trim()) ||
        sp.product.images[0]?.url ||
        null;
      return {
        id: sp.id,
        productName: sp.product.name,
        variant: variant && variant.length > 0 ? variant : '—',
        sku,
        branchName: sp.branch.name,
        inStock: sp.quantity,
        soldStock,
        productImage: img,
        sellingPrice: Number(sp.sellingPrice),
        value: sp.quantity * Number(sp.sellingPrice),
      };
    });

    return {
      totalProducts,
      totalQty,
      totalValue,
      lowStockItems: [],
      lowStock: lowStockCount,
      lowStockCount,
      stats: {
        totalInStock: totalQty,
        totalSold: totalSoldAll,
      },
      products: [],
      items,
      total: totalRows,
      page,
      lastPage,
      totalPages: lastPage,
      limit,
    };
  }
}
