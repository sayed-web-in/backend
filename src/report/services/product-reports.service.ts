import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { bdDayEndUtc, bdDayStartUtc } from '../../common/bd-time.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReportQueryDto } from '../dto/report-query.dto.js';
import {
  financeLinePagination,
  salesReportSaleWhere,
} from '../helpers/report-query.utils.js';

@Injectable()
export class ProductReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async productReport(query: ReportQueryDto) {
    const saleWhere = salesReportSaleWhere(query);

    const grouped = await this.prisma.saleItem.groupBy({
      by: ['storeProductId'],
      where: { sale: saleWhere },
      _sum: { quantity: true, total: true },
      _avg: { unitPrice: true },
      orderBy: { _sum: { total: 'desc' } },
    });

    const ids = grouped.map((i) => i.storeProductId);
    const storeProducts =
      ids.length === 0
        ? []
        : await this.prisma.storeProduct.findMany({
            where: { id: { in: ids } },
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  categoryId: true,
                  subCategoryId: true,
                  brandId: true,
                  category: { select: { name: true } },
                  subCategory: { select: { name: true } },
                  brand: { select: { name: true } },
                },
              },
              branch: { select: { id: true, name: true } },
            },
          });
    const spMap = new Map(storeProducts.map((sp) => [sp.id, sp]));

    let rows = grouped.map((i) => {
      const sp = spMap.get(i.storeProductId);
      const p = sp?.product;
      return {
        storeProductId: i.storeProductId,
        productId: sp?.productId ?? 0,
        productName: p?.name ?? 'Unknown',
        sku: p?.sku ?? null,
        branchName: sp?.branch?.name ?? null,
        categoryName: p?.category?.name ?? null,
        subCategoryName: p?.subCategory?.name ?? null,
        brandName: p?.brand?.name ?? null,
        totalSoldQty: Number(i._sum.quantity ?? 0),
        totalRevenue: Number(i._sum.total ?? 0),
        averagePrice: Number(i._avg.unitPrice ?? 0),
      };
    });

    if (query.categoryId != null) {
      rows = rows.filter((r) => {
        const sp = spMap.get(r.storeProductId);
        return sp?.product?.categoryId === query.categoryId;
      });
    }
    if (query.subCategoryId != null) {
      rows = rows.filter((r) => {
        const sp = spMap.get(r.storeProductId);
        return sp?.product?.subCategoryId === query.subCategoryId;
      });
    }
    if (query.brandId != null) {
      rows = rows.filter((r) => {
        const sp = spMap.get(r.storeProductId);
        return sp?.product?.brandId === query.brandId;
      });
    }

    const totalSoldQty = rows.reduce((s, r) => s + r.totalSoldQty, 0);
    const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);
    const productIds = new Set(rows.map((r) => r.productId).filter((id) => id > 0));

    const { limit, page, skip } = financeLinePagination(query);
    const totalRows = rows.length;
    const lastPage = Math.max(1, Math.ceil(totalRows / limit));
    const pageRows = rows.slice(skip, skip + limit);

    const products = pageRows.map((r) => ({
      product: r.productName,
      category: r.categoryName ?? '—',
      brand: r.brandName ?? '—',
      sold: r.totalSoldQty,
      revenue: r.totalRevenue,
      avgPrice: r.averagePrice,
    }));

    return {
      summary: {
        lineCount: totalRows,
        uniqueProducts: productIds.size,
        totalSoldQty,
        totalRevenue,
      },
      totalProducts: productIds.size,
      totalSold: totalSoldQty,
      totalRevenue,
      products,
      items: pageRows,
      total: totalRows,
      page,
      lastPage,
      totalPages: lastPage,
      limit,
    };
  }

  async productExpiryReport(query: ReportQueryDto) {
    const minAge = query.batchMinAgeDays ?? 90;
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - minAge);

    const from = query.dateFrom ?? query.startDate;
    const to = query.dateTo ?? query.endDate;
    const endTo = to ? bdDayEndUtc(to) : null;
    const lteDate =
      endTo != null && endTo.getTime() < thresholdDate.getTime()
        ? endTo
        : thresholdDate;
    const batchDateWhere: Prisma.DateTimeFilter = {
      lte: lteDate,
      ...(from ? { gte: bdDayStartUtc(from) } : {}),
    };

    const productWhere: Prisma.ProductWhereInput = {};
    if (query.categoryId != null) productWhere.categoryId = query.categoryId;
    if (query.subCategoryId != null) productWhere.subCategoryId = query.subCategoryId;
    if (query.brandId != null) productWhere.brandId = query.brandId;

    const storeProductWhere: Prisma.StoreProductWhereInput = {
      ...(query.branchId != null && Number.isFinite(query.branchId)
        ? { branchId: Math.floor(Number(query.branchId)) }
        : {}),
      ...(Object.keys(productWhere).length > 0 ? { product: productWhere } : {}),
    };

    const baseWhere: Prisma.BatchWhereInput = {
      batchDate: batchDateWhere,
      availableQty: { gt: 0 },
      storeProduct: storeProductWhere,
    };

    const { limit, page, skip } = financeLinePagination(query);

    const [totalRows, qtyAgg, batches] = await Promise.all([
      this.prisma.batch.count({ where: baseWhere }),
      this.prisma.batch.aggregate({
        where: baseWhere,
        _sum: { availableQty: true },
      }),
      this.prisma.batch.findMany({
        where: baseWhere,
        orderBy: { batchDate: 'asc' },
        skip,
        take: limit,
        include: {
          storeProduct: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  category: { select: { name: true } },
                  brand: { select: { name: true } },
                },
              },
              branch: { select: { id: true, name: true } },
            },
          },
          supplier: { select: { id: true, name: true } },
        },
      }),
    ]);

    const lastPage = Math.max(1, Math.ceil(totalRows / limit));
    const totalQty = Number(qtyAgg._sum.availableQty ?? 0);

    const items = batches.map((b) => ({
      batchId: b.id,
      batchNumber: b.batchNumber,
      batchDate: b.batchDate.toISOString(),
      daysOld: Math.floor(
        (Date.now() - b.batchDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
      quantity: b.availableQty,
      availableQty: b.availableQty,
      purchaseCost: Number(b.purchaseCost),
      productName: b.storeProduct.product.name,
      sku: b.storeProduct.product.sku,
      categoryName: b.storeProduct.product.category?.name ?? null,
      brandName: b.storeProduct.product.brand?.name ?? null,
      branchName: b.storeProduct.branch.name,
      supplierName: b.supplier?.name ?? null,
    }));

    return {
      summary: {
        totalBatches: totalRows,
        totalAvailableQty: totalQty,
        minAgeDays: minAge,
      },
      items,
      total: totalRows,
      page,
      lastPage,
      totalPages: lastPage,
      limit,
    };
  }

  async productQuantityReport(query: ReportQueryDto) {
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

    const { limit, page, skip } = financeLinePagination(query);

    const minimal = await this.prisma.storeProduct.findMany({
      where: storeWhere,
      select: {
        productId: true,
        quantity: true,
        sellingPrice: true,
      },
    });

    let totalAvailable = 0;
    let totalValue = 0;
    const pidSet = new Set<number>();
    for (const m of minimal) {
      pidSet.add(m.productId);
      totalAvailable += m.quantity;
      totalValue += m.quantity * Number(m.sellingPrice);
    }
    const distinctProducts = pidSet.size;
    const totalRows = minimal.length;

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
              category: { select: { name: true } },
              brand: { select: { name: true } },
            },
          },
          branch: { select: { id: true, name: true } },
          productVariant: {
            select: {
              sku: true,
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
          batches: { select: { soldQty: true } },
        },
      }),
    ]);

    const lastPage = Math.max(1, Math.ceil(totalRows / limit));
    const totalSoldAll = Number(soldAgg._sum.soldQty ?? 0);

    const items = pageRows.map((sp) => {
      const soldQty = sp.batches.reduce((s, b) => s + b.soldQty, 0);
      const variant = sp.productVariant
        ? sp.productVariant.attributes
            .map(
              (a) =>
                `${a.attributeValue.attribute.name}: ${a.attributeValue.value}`,
            )
            .join(', ')
        : null;
      const sku = sp.productVariant?.sku ?? sp.product.sku ?? '—';
      return {
        id: sp.id,
        productName: sp.product.name,
        variant: variant && variant.length > 0 ? variant : '—',
        sku,
        branchName: sp.branch.name,
        categoryName: sp.product.category?.name ?? null,
        brandName: sp.product.brand?.name ?? null,
        availableQty: sp.quantity,
        soldQty,
        sellingPrice: Number(sp.sellingPrice),
        totalValue: sp.quantity * Number(sp.sellingPrice),
      };
    });

    return {
      summary: {
        distinctProducts,
        totalLines: totalRows,
        totalAvailableQty: totalAvailable,
        totalSoldQty: totalSoldAll,
        totalValue,
      },
      items,
      total: totalRows,
      page,
      lastPage,
      totalPages: lastPage,
      limit,
    };
  }
}
