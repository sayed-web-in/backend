import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { AddToStoreDto } from './dto/add-to-store.dto.js';
import { UpdateStoreProductDto } from './dto/update-store-product.dto.js';
import {
  ProductQueryDto,
  StoreProductQueryDto,
  DraftProductQueryDto,
} from './dto/product-query.dto.js';
import { PriceListQueryDto } from './dto/price-list-query.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';
import { avgPurchaseUnitCostByStoreProductIds } from '../common/avg-purchase-unit-cost.js';
import { Prisma, ProductType, ProductStatus } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  /** Public storefront: counter-only (STORE) SKUs must not appear. */
  private readonly webStoreProductWhere: Prisma.StoreProductWhereInput = {
    isActive: true,
    sellingType: { in: ['ONLINE', 'BOTH'] },
  };

  private toUploadsFsPath(url?: string | null): string | null {
    if (!url) return null;
    let pathPart = url.trim();
    if (!pathPart) return null;

    if (/^https?:\/\//i.test(pathPart)) {
      try {
        const parsed = new URL(pathPart);
        pathPart = parsed.pathname || '';
      } catch {
        return null;
      }
    }

    if (!pathPart.startsWith('/uploads/')) return null;

    const decoded = decodeURIComponent(pathPart).replace(/\\/g, '/');
    const relative = decoded.replace(/^\/+/, '');
    if (relative.includes('..')) return null;

    return join(process.cwd(), relative);
  }

  private async deleteUploadFiles(urls: (string | null | undefined)[]) {
    const paths = [...new Set(urls.map((u) => this.toUploadsFsPath(u)).filter(Boolean) as string[])];
    await Promise.all(
      paths.map(async (p) => {
        try {
          await unlink(p);
        } catch {
          // Best-effort cleanup; ignore missing/locked files.
        }
      }),
    );
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private generateSku(prefix: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${ts}-${rand}`;
  }

  private generateBarcode(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `BAR-${ts}-${rand}`;
  }

  async create(dto: CreateProductDto) {
    const { images, specifications, variants, ...data } = dto;

    let slug = this.generateSlug(data.name);
    const existing = await this.prisma.product.findUnique({ where: { slug } });
    if (existing) {
      const rand = Math.random().toString(36).substring(2, 6);
      slug = `${slug}-${rand}`;
    }

    return this.prisma.product.create({
      data: {
        ...data,
        slug,
        status: 'DRAFT',
        images: images?.length
          ? {
              create: images.map((img) => ({
                url: img.url,
                sortOrder: img.sortOrder ?? 0,
              })),
            }
          : undefined,
        specifications: specifications?.length
          ? {
              create: specifications.map((s) => ({
                name: s.name,
                value: s.value,
              })),
            }
          : undefined,
        variants:
          data.type === ProductType.VARIABLE && variants?.length
            ? {
                create: variants.map((v) => ({
                  sku: v.sku?.trim() || this.generateSku('VAR'),
                  image: v.image,
                  attributes: {
                    create: v.attributeValueIds.map((avId) => ({
                      attributeValueId: avId,
                    })),
                  },
                })),
              }
            : undefined,
      },
      include: {
        images: true,
        specifications: true,
        variants: {
          include: { attributes: { include: { attributeValue: true } } },
        },
        category: true,
        subCategory: true,
        brand: true,
        unit: true,
        taxRate: true,
      },
    });
  }

  async addToStore(dto: AddToStoreDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    if (
      product.hasImei &&
      dto.quantity > 0 &&
      (!dto.serialNumbers || dto.serialNumbers.length !== dto.quantity)
    ) {
      throw new BadRequestException(
        'Serial numbers count must match quantity for IMEI-tracked products',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const storeProduct = await tx.storeProduct.create({
        data: {
          productId: dto.productId,
          productVariantId: dto.productVariantId,
          branchId: dto.branchId,
          quantity: dto.quantity,
          averageCost: new Prisma.Decimal(dto.purchaseCost).toDecimalPlaces(6),
          sellingPrice: dto.sellingPrice,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          quantityAlert: dto.quantityAlert ?? 5,
          sellingType: dto.sellingType ?? 'BOTH',
          isBestDeal: dto.isBestDeal ?? false,
          isFeatured: dto.isFeatured ?? false,
        },
      });

      /** Readable, unique id; includes INITIAL so add-product → add store listings are obvious in batch list. */
      const batchNumber = `BATCH-INITIAL-SP${storeProduct.id}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const barcode = this.generateBarcode();
      const now = new Date();

      const batch = await tx.batch.create({
        data: {
          batchNumber,
          barcode,
          batchType: 'initial',
          batchDate: now,
          initialQty: dto.quantity,
          availableQty: dto.quantity,
          soldQty: 0,
          returnQty: 0,
          purchaseCost: dto.purchaseCost,
          totalCost: dto.purchaseCost * dto.quantity,
          supplierId: dto.supplierId,
          storeProductId: storeProduct.id,
        },
      });

      if (product.hasImei && dto.serialNumbers?.length) {
        await tx.serialNumber.createMany({
          data: dto.serialNumbers.map((serial) => ({
            serial,
            batchId: batch.id,
            status: 'IN_STOCK',
          })),
        });
      }

      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'ACTIVE' },
      });

      return tx.storeProduct.findUnique({
        where: { id: storeProduct.id },
        include: {
          product: true,
          productVariant: true,
          branch: true,
          batches: { include: { serialNumbers: true } },
        },
      });
    });
  }

  async findAll(query: ProductQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      categoryId,
      subCategoryId,
      brandId,
      status,
      isBestDeal,
      isFeatured,
      priceMin,
      priceMax,
      branchId,
      sellingType,
      forWebsite,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const onlyArchived = query.isArchived === true;
    const where: any = onlyArchived ? { isArchived: true } : { isArchived: false };
    const useWebCatalog = forWebsite === true && !onlyArchived;

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (subCategoryId) where.subCategoryId = subCategoryId;
    if (brandId) where.brandId = brandId;
    if (useWebCatalog) {
      where.status = ProductStatus.ACTIVE;
    } else if (status) {
      where.status = status;
    }

    if (
      useWebCatalog ||
      isBestDeal !== undefined ||
      isFeatured !== undefined ||
      priceMin ||
      priceMax ||
      branchId ||
      (sellingType != null && !useWebCatalog)
    ) {
      const storeWhere: Prisma.StoreProductWhereInput = {};
      if (useWebCatalog) {
        Object.assign(storeWhere, this.webStoreProductWhere);
      }
      if (isBestDeal !== undefined) storeWhere.isBestDeal = isBestDeal;
      if (isFeatured !== undefined) storeWhere.isFeatured = isFeatured;
      if (priceMin || priceMax) {
        storeWhere.sellingPrice = {};
        if (priceMin) storeWhere.sellingPrice.gte = priceMin;
        if (priceMax) storeWhere.sellingPrice.lte = priceMax;
      }
      if (branchId) storeWhere.branchId = branchId;
      if (sellingType != null && !useWebCatalog) {
        storeWhere.sellingType = sellingType;
      }
      where.storeProducts = { some: storeWhere };
    }

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else if (onlyArchived) {
      orderBy.updatedAt = 'desc';
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          category: true,
          brand: true,
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { image: true },
          },
          storeProducts: {
            ...(useWebCatalog ? { where: this.webStoreProductWhere } : {}),
            include: {
              branch: true,
              productVariant: {
                select: {
                  sku: true,
                  image: true,
                  attributes: {
                    select: {
                      attributeValue: {
                        select: { value: true },
                      },
                    },
                  },
                },
              },
            },
            take: 5,
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number, forWebsite = false) {
    const product = await this.prisma.product.findFirst({
      where: forWebsite
        ? {
            id,
            isArchived: false,
            status: ProductStatus.ACTIVE,
          }
        : { id },
      include: {
        category: {
          include: { branches: { include: { branch: true } } },
        },
        subCategory: true,
        brand: true,
        unit: true,
        taxRate: true,
        images: { orderBy: { sortOrder: 'asc' } },
        specifications: true,
        variants: {
          include: {
            attributes: {
              include: {
                attributeValue: { include: { attribute: true } },
              },
            },
          },
        },
        storeProducts: {
          ...(forWebsite ? { where: this.webStoreProductWhere } : {}),
          include: {
            branch: true,
            productVariant: true,
            batches: { include: { serialNumbers: true } },
          },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        slug,
        isArchived: false,
        status: ProductStatus.ACTIVE,
      },
      include: {
        category: true,
        subCategory: true,
        brand: true,
        unit: true,
        taxRate: true,
        images: { orderBy: { sortOrder: 'asc' } },
        specifications: true,
        variants: {
          include: {
            attributes: {
              include: {
                attributeValue: { include: { attribute: true } },
              },
            },
            storeProducts: {
              where: this.webStoreProductWhere,
              include: { branch: true },
            },
          },
        },
        storeProducts: {
          where: this.webStoreProductWhere,
          include: { branch: true },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: number, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: { select: { url: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const { images, specifications, variants, ...data } =
      dto as CreateProductDto;

    const obsoleteImageUrls: string[] = [];
    if (images) {
      const nextImageUrls = new Set(images.map((img) => img.url));
      for (const prev of product.images) {
        if (!nextImageUrls.has(prev.url)) obsoleteImageUrls.push(prev.url);
      }
      await this.prisma.productImage.deleteMany({ where: { productId: id } });
    }
    if (specifications) {
      await this.prisma.specification.deleteMany({ where: { productId: id } });
    }

    await this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        images: images
          ? {
              create: images.map((img) => ({
                url: img.url,
                sortOrder: img.sortOrder ?? 0,
              })),
            }
          : undefined,
        specifications: specifications
          ? {
              create: specifications.map((s) => ({
                name: s.name,
                value: s.value,
              })),
            }
          : undefined,
      },
    });

    const obsoleteVariantImageUrls: string[] = [];
    if (variants !== undefined && product.type === ProductType.VARIABLE) {
      if (product.status === ProductStatus.DRAFT) {
        const removed = await this.reconcileDraftVariants(id, variants);
        obsoleteVariantImageUrls.push(...removed);
      } else {
        const removed = await this.appendVariantsForNonDraft(id, variants);
        obsoleteVariantImageUrls.push(...removed);
      }
    }

    await this.deleteUploadFiles([...obsoleteImageUrls, ...obsoleteVariantImageUrls]);

    return this.findOne(id);
  }

  /**
   * Sync variants for a DRAFT variable product: update by id, create without id, delete orphans with no store rows.
   */
  private async reconcileDraftVariants(
    productId: number,
    variants: NonNullable<CreateProductDto['variants']>,
  ): Promise<string[]> {
    const removedImageUrls: string[] = [];
    const existing = await this.prisma.productVariant.findMany({
      where: { productId },
      select: {
        id: true,
        image: true,
        _count: { select: { storeProducts: true } },
      },
    });

    const incomingWithId = new Set(
      variants.filter((v) => v.id != null).map((v) => v.id as number),
    );

    for (const ex of existing) {
      if (!incomingWithId.has(ex.id) && ex._count.storeProducts === 0) {
        await this.prisma.productVariant.delete({ where: { id: ex.id } });
        if (ex.image) removedImageUrls.push(ex.image);
      }
    }

    for (const v of variants) {
      if (!v.attributeValueIds?.length) {
        throw new BadRequestException(
          'Each variant must include at least one attribute value',
        );
      }

      if (v.id != null) {
        const row = await this.prisma.productVariant.findFirst({
          where: { id: v.id, productId },
          select: { id: true, image: true },
        });
        if (!row) {
          throw new BadRequestException(
            `Variant ${v.id} does not belong to this product`,
          );
        }

        const variantUpdate: Prisma.ProductVariantUpdateInput = {
          attributes: {
            deleteMany: {},
            create: v.attributeValueIds.map((attributeValueId) => ({
              attributeValueId,
            })),
          },
        };
        if (v.image !== undefined) {
          variantUpdate.image = v.image;
          if (row.image && row.image !== v.image) removedImageUrls.push(row.image);
        }
        if (v.sku?.trim()) variantUpdate.sku = v.sku.trim();

        await this.prisma.productVariant.update({
          where: { id: v.id },
          data: variantUpdate,
        });
      } else {
        await this.prisma.productVariant.create({
          data: {
            productId,
            sku: v.sku?.trim() || this.generateSku('VAR'),
            image: v.image,
            attributes: {
              create: v.attributeValueIds.map((attributeValueId) => ({
                attributeValueId,
              })),
            },
          },
        });
      }
    }
    return removedImageUrls;
  }

  /**
   * Non-draft products: only append newly added variants (no id).
   * Existing variants are kept unchanged to avoid accidental destructive edits.
   */
  private async appendVariantsForNonDraft(
    productId: number,
    variants: NonNullable<CreateProductDto['variants']>,
  ): Promise<string[]> {
    const removedImageUrls: string[] = [];
    const existing = await this.prisma.productVariant.findMany({
      where: { productId },
      select: {
        id: true,
        sku: true,
        image: true,
        attributes: {
          select: { attributeValueId: true },
        },
      },
    });

    const existingSkus = new Set(
      existing.map((v) => (v.sku || '').trim().toLowerCase()).filter(Boolean),
    );

    const existingAttrKeys = new Set(
      existing.map((v) =>
        v.attributes
          .map((a) => a.attributeValueId)
          .sort((a, b) => a - b)
          .join(':'),
      ),
    );
    const existingById = new Map(existing.map((v) => [v.id, v]));

    for (const v of variants) {
      if (!v.attributeValueIds?.length) {
        throw new BadRequestException(
          'Each variant must include at least one attribute value',
        );
      }

      if (v.id != null) {
        const row = existingById.get(v.id);
        if (!row) continue;

        const variantUpdate: Prisma.ProductVariantUpdateInput = {};
        if (v.sku?.trim()) variantUpdate.sku = v.sku.trim();
        if (v.image !== undefined) {
          variantUpdate.image = v.image;
          if (row.image && row.image !== v.image) removedImageUrls.push(row.image);
        }
        if (Object.keys(variantUpdate).length > 0) {
          await this.prisma.productVariant.update({
            where: { id: v.id },
            data: variantUpdate,
          });
        }
        continue;
      }

      const skuKey = (v.sku || '').trim().toLowerCase();
      const attrKey = [...v.attributeValueIds].sort((a, b) => a - b).join(':');

      // Skip duplicates so repeated saves don't create the same new variant again.
      if ((skuKey && existingSkus.has(skuKey)) || existingAttrKeys.has(attrKey)) {
        continue;
      }

      await this.prisma.productVariant.create({
        data: {
          productId,
          sku: v.sku?.trim() || this.generateSku('VAR'),
          image: v.image,
          attributes: {
            create: v.attributeValueIds.map((attributeValueId) => ({
              attributeValueId,
            })),
          },
        },
      });

      if (skuKey) existingSkus.add(skuKey);
      existingAttrKeys.add(attrKey);
    }
    return removedImageUrls;
  }

  async updateStoreProduct(storeProductId: number, dto: UpdateStoreProductDto) {
    const sp = await this.prisma.storeProduct.findUnique({
      where: { id: storeProductId },
      include: { batches: true },
    });
    if (!sp) throw new NotFoundException('Store product not found');

    const updateData: Prisma.StoreProductUpdateInput = {};
    if (dto.sellingPrice !== undefined)
      updateData.sellingPrice = dto.sellingPrice;
    if (dto.averageCost !== undefined)
      updateData.averageCost = dto.averageCost;
    if (dto.discountType !== undefined)
      updateData.discountType = dto.discountType;
    if (dto.discountValue !== undefined)
      updateData.discountValue = dto.discountValue;
    if (dto.quantityAlert !== undefined)
      updateData.quantityAlert = dto.quantityAlert;
    if (dto.sellingType !== undefined) updateData.sellingType = dto.sellingType;
    if (dto.isBestDeal !== undefined) updateData.isBestDeal = dto.isBestDeal;
    if (dto.isFeatured !== undefined) updateData.isFeatured = dto.isFeatured;

    if (dto.purchaseCostPerUnit !== undefined) {
      if (sp.batches.length !== 1) {
        throw new BadRequestException(
          'Purchase cost can only be edited when this listing has exactly one batch',
        );
      }
      const batch = sp.batches[0];
      if (batch.soldQty > 0) {
        throw new BadRequestException(
          'Cannot change purchase cost after items from this batch have been sold',
        );
      }
      const unit = dto.purchaseCostPerUnit;
      const totalCost = unit * batch.initialQty;
      await this.prisma.batch.update({
        where: { id: batch.id },
        data: {
          purchaseCost: unit,
          totalCost,
        },
      });
      updateData.averageCost = unit;
    }

    return this.prisma.storeProduct.update({
      where: { id: storeProductId },
      data: updateData,
      include: {
        branch: true,
        productVariant: {
          include: {
            attributes: {
              include: { attributeValue: { include: { attribute: true } } },
            },
          },
        },
        batches: { include: { serialNumbers: true } },
      },
    });
  }

  async deleteStoreProduct(storeProductId: number) {
    const sp = await this.prisma.storeProduct.findUnique({
      where: { id: storeProductId },
      include: {
        batches: true,
        _count: {
          select: {
            saleItems: true,
            purchaseItems: true,
            orderItems: true,
          },
        },
      },
    });
    if (!sp) throw new NotFoundException('Store product not found');

    if (
      sp._count.saleItems > 0 ||
      sp._count.purchaseItems > 0 ||
      sp._count.orderItems > 0
    ) {
      throw new BadRequestException(
        'Cannot delete this store listing: it is linked to sales, purchases, or orders',
      );
    }

    if (sp.quantity > 0) {
      throw new BadRequestException(
        'Cannot delete while stock quantity is greater than zero; adjust stock first',
      );
    }

    if (sp.batches.some((b) => b.soldQty > 0)) {
      throw new BadRequestException(
        'Cannot delete: a batch has recorded sales',
      );
    }

    const [adjCount, xferCount] = await Promise.all([
      this.prisma.stockAdjustmentItem.count({ where: { storeProductId } }),
      this.prisma.stockTransferItem.count({ where: { storeProductId } }),
    ]);
    if (adjCount > 0 || xferCount > 0) {
      throw new BadRequestException(
        'Cannot delete: this listing is referenced by stock adjustments or transfers',
      );
    }

    await this.prisma.storeProduct.delete({ where: { id: storeProductId } });
    return { ok: true };
  }

  async getBranchVariants(productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        storeProducts: {
          where: { isActive: true },
          include: {
            branch: true,
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
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const variants = product.storeProducts.map((sp) => {
      const attrs = sp.productVariant?.attributes ?? [];
      const variantLabel =
        attrs.length > 0
          ? attrs
              .map(
                (a) =>
                  `${a.attributeValue.attribute.name}: ${a.attributeValue.value}`,
              )
              .join(', ')
          : product.type === ProductType.SINGLE
            ? 'Default'
            : undefined;

      return {
        id: sp.id,
        branchName: sp.branch.name,
        image: sp.productVariant?.image ?? undefined,
        variantLabel,
        quantity: sp.quantity,
        sellingPrice: Number(sp.sellingPrice),
        date: sp.createdAt.toISOString(),
        quantityAlert: sp.quantityAlert,
      };
    });

    return { variants };
  }

  async getBatchById(batchId: number) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        serialNumbers: true,
        supplier: true,
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    return {
      batch: {
        id: batch.id,
        batchNumber: batch.batchNumber,
        barcode: batch.barcode ?? '',
        type: batch.batchType,
        initialQty: batch.initialQty,
        availableQty: batch.availableQty,
        soldQty: batch.soldQty,
        returnQty: batch.returnQty,
        purchaseCost: Number(batch.purchaseCost),
        totalCost: Number(batch.totalCost),
        batchDate: batch.batchDate.toISOString(),
        supplier: batch.supplier
          ? {
              name: batch.supplier.name,
              phone: batch.supplier.phone ?? undefined,
              email: batch.supplier.email ?? undefined,
            }
          : undefined,
        serialNumbers: batch.serialNumbers.map((s) => ({
          id: s.id,
          serial: s.serial,
          status: s.status,
          createdAt: s.createdAt.toISOString(),
        })),
      },
    };
  }

  async archive(id: number) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { isArchived: true },
    });
  }

  async restore(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.update({
      where: { id },
      data: { isArchived: false },
    });
  }

  /** Permanently remove an archived catalog product (no sales / orders / purchase lines). */
  async permanentDeleteArchived(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, isArchived: true, name: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.isArchived) {
      throw new BadRequestException(
        'Only archived products can be permanently deleted. Archive the product first.',
      );
    }

    const [saleN, orderN, purN] = await Promise.all([
      this.prisma.saleItem.count({ where: { storeProduct: { productId: id } } }),
      this.prisma.orderItem.count({ where: { storeProduct: { productId: id } } }),
      this.prisma.purchaseItem.count({ where: { storeProduct: { productId: id } } }),
    ]);
    if (saleN + orderN + purN > 0) {
      throw new BadRequestException(
        'This product still has linked POS sales, ecommerce orders, or purchase lines. It cannot be permanently deleted.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const stores = await tx.storeProduct.findMany({
        where: { productId: id },
        select: { id: true },
      });
      const storeIds = stores.map((s) => s.id);
      if (storeIds.length > 0) {
        await tx.serialNumber.deleteMany({
          where: { batch: { storeProductId: { in: storeIds } } },
        });
        await tx.batch.deleteMany({ where: { storeProductId: { in: storeIds } } });
      }
      await tx.storeProduct.deleteMany({ where: { productId: id } });
      await tx.productVariant.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    return { ok: true, id, name: product.name };
  }

  async getStoreProducts(query: StoreProductQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      branchId,
      brandId,
      categoryId,
      isActive,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (typeof isActive === 'boolean') where.isActive = isActive;

    const productWhere: any = {};
    if (brandId) productWhere.brandId = brandId;
    if (categoryId) productWhere.categoryId = categoryId;
    if (search) {
      productWhere.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
      ];
    }
    if (Object.keys(productWhere).length) {
      where.product = productWhere;
    }

    const [data, total] = await Promise.all([
      this.prisma.storeProduct.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            include: {
              images: { take: 1, orderBy: { sortOrder: 'asc' } },
              brand: true,
              category: true,
            },
          },
          productVariant: {
            include: {
              attributes: { include: { attributeValue: true } },
            },
          },
          branch: true,
          _count: { select: { batches: true } },
        },
      }),
      this.prisma.storeProduct.count({ where }),
    ]);

    const ids = data.map((r) => r.id);
    const costMap =
      ids.length > 0
        ? await avgPurchaseUnitCostByStoreProductIds(this.prisma, ids)
        : new Map<number, number>();
    const enriched = data.map((row) => ({
      ...row,
      avgPurchaseUnitCost:
        Number(row.averageCost) > 0
          ? Number(row.averageCost)
          : costMap.get(row.id) ?? 0,
    }));

    return paginate(enriched, total, page, limit);
  }

  async getPriceList(query: PriceListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const skip = (page - 1) * limit;

    const productWhere: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      isArchived: false,
    };
    if (query.categoryId) productWhere.categoryId = query.categoryId;
    if (query.brandId) productWhere.brandId = query.brandId;
    if (query.search?.trim()) {
      const s = query.search.trim();
      productWhere.OR = [
        { name: { contains: s } },
        { sku: { contains: s } },
        { variants: { some: { sku: { contains: s } } } },
      ];
    }

    const whereBase: Prisma.StoreProductWhereInput = {
      isActive: true,
      product: productWhere,
    };
    if (query.branchId != null && Number.isFinite(query.branchId)) {
      whereBase.branchId = query.branchId;
    }

    const lite = await this.prisma.storeProduct.findMany({
      where: whereBase,
      select: {
        id: true,
        productId: true,
        branchId: true,
        quantity: true,
        quantityAlert: true,
        sellingPrice: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let filtered = lite;
    const st = query.stockStatus?.trim();
    if (st === 'in_stock') {
      filtered = lite.filter((x) => x.quantity > 0);
    } else if (st === 'out_of_stock') {
      filtered = lite.filter((x) => x.quantity === 0);
    } else if (st === 'low_stock') {
      filtered = lite.filter(
        (x) => x.quantity > 0 && x.quantity <= x.quantityAlert,
      );
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageSlice = filtered.slice(skip, skip + limit);
    const idList = pageSlice.map((x) => x.id);

    const allIds = filtered.map((x) => x.id);
    const costMapAll =
      allIds.length > 0
        ? await avgPurchaseUnitCostByStoreProductIds(this.prisma, allIds)
        : new Map<number, number>();

    let totalPurchaseValue = 0;
    let totalSellingValue = 0;
    const distinctProducts = new Set<number>();
    for (const row of filtered) {
      distinctProducts.add(row.productId);
      const c = costMapAll.get(row.id) ?? 0;
      totalPurchaseValue += row.quantity * c;
      totalSellingValue += row.quantity * Number(row.sellingPrice);
    }

    if (idList.length === 0) {
      return {
        items: [] as Record<string, unknown>[],
        total,
        totalPages,
        page,
        limit,
        stats: {
          totalItems: total,
          totalProducts: distinctProducts.size,
          totalPurchaseValue,
          totalSellingValue,
        },
      };
    }

    const fullRows = await this.prisma.storeProduct.findMany({
      where: { id: { in: idList } },
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { take: 1, orderBy: { sortOrder: 'asc' } },
          },
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
    });

    const orderMap = new Map(idList.map((id, i) => [id, i]));
    fullRows.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

    const items = fullRows.map((sp) => {
      const p = sp.product;
      const v = sp.productVariant;
      const attrs = v?.attributes
        ?.map((a) => a.attributeValue?.value)
        .filter((x): x is string => Boolean(x && String(x).trim()));
      const variantDisplay = attrs?.length
        ? attrs.join(', ')
        : v?.sku || p.sku || '';
      const sku = v?.sku || p.sku || '';
      const purchasePrice = costMapAll.get(sp.id) ?? 0;
      const productType =
        p.type === 'VARIABLE' ? 'variable' : 'single';
      const productImage = p.images?.[0]?.url ?? '';

      return {
        id: String(sp.id),
        productId: String(p.id),
        variantId: v ? String(v.id) : '0',
        priceId: String(sp.id),
        productName: p.name,
        productType,
        productImage,
        productCreatedAt: p.createdAt.toISOString(),
        categoryId: p.categoryId != null ? String(p.categoryId) : null,
        brandId: p.brandId != null ? String(p.brandId) : null,
        variantDisplay,
        sku,
        stockQuantity: sp.quantity,
        lowStockThreshold: sp.quantityAlert,
        purchasePrice,
        sellingPrice: Number(sp.sellingPrice),
        branchId: String(sp.branchId),
      };
    });

    return {
      items,
      total,
      totalPages,
      page,
      limit,
      stats: {
        totalItems: total,
        totalProducts: distinctProducts.size,
        totalPurchaseValue,
        totalSellingValue,
      },
    };
  }

  async getDraftProducts(query: DraftProductQueryDto) {
    const { page = 1, limit = 16, search, brandId, categoryId, status } = query;
    const skip = (page - 1) * limit;

    const where: any = { isArchived: false };
    const hasOtherFilters = !!(brandId || categoryId || search);
    if (status) {
      where.status = status;
    } else if (!hasOtherFilters) {
      where.status = 'DRAFT';
    }
    if (brandId) where.brandId = brandId;
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [{ name: { contains: search } }, { sku: { contains: search } }],
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          category: true,
          brand: true,
          images: { take: 1, orderBy: { sortOrder: 'asc' } },
          variants: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { image: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getLowStock(query: StoreProductQueryDto) {
    const { page = 1, limit = 100, branchId, search, level } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (search) {
      where.product = {
        name: { contains: search },
      };
    }

    const rows = await this.prisma.storeProduct.findMany({
      where,
      orderBy: [{ quantity: 'asc' }, { id: 'desc' }],
      include: {
        product: {
          include: {
            images: { take: 1, orderBy: { sortOrder: 'asc' } },
            taxRate: true,
          },
        },
        branch: true,
        productVariant: {
          include: {
            attributes: { include: { attributeValue: true } },
          },
        },
      },
    });

    let filtered = rows.filter((sp) => sp.quantity <= sp.quantityAlert);
    if (level === 'critical') {
      filtered = filtered.filter((sp) => sp.quantity === 0);
    } else if (level === 'warning') {
      filtered = filtered.filter((sp) => sp.quantity > 0);
    }
    const total = filtered.length;
    const data = filtered.slice(skip, skip + limit);

    return paginate(data, total, page, limit);
  }

  async getBatches(storeProductId: number) {
    const sp = await this.prisma.storeProduct.findUnique({
      where: { id: storeProductId },
    });
    if (!sp) throw new NotFoundException('Store product not found');

    return this.prisma.batch.findMany({
      where: { storeProductId },
      orderBy: { createdAt: 'desc' },
      include: {
        serialNumbers: true,
        supplier: true,
      },
    });
  }

  /** IN_STOCK serials for ecommerce order fulfillment / POS-style sellout. */
  async getAvailableSerialsForStoreProduct(storeProductId: number) {
    const sp = await this.prisma.storeProduct.findUnique({
      where: { id: storeProductId },
      include: { product: { select: { hasImei: true, name: true } } },
    });
    if (!sp) throw new NotFoundException('Store product not found');

    const serials = await this.prisma.serialNumber.findMany({
      where: {
        status: 'IN_STOCK',
        batch: { storeProductId },
      },
      select: { id: true, serial: true },
      orderBy: { id: 'asc' },
    });

    return {
      hasImei: sp.product.hasImei,
      productName: sp.product.name,
      serials,
    };
  }

  async getSitemapProducts() {
    return this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        isArchived: false,
        storeProducts: { some: this.webStoreProductWhere },
      },
      select: { slug: true, updatedAt: true },
    });
  }

  async search(query: string, categoryId?: number) {
    const where: any = {
      status: 'ACTIVE',
      isArchived: false,
      OR: [{ name: { contains: query } }, { description: { contains: query } }],
    };
    if (categoryId) where.categoryId = categoryId;
    where.storeProducts = { some: this.webStoreProductWhere };

    const products = await this.prisma.product.findMany({
      where,
      include: {
        images: { take: 1, orderBy: { sortOrder: 'asc' } },
        variants: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { image: true },
        },
        category: true,
        brand: true,
        storeProducts: {
          where: this.webStoreProductWhere,
          include: { productVariant: { select: { image: true } } },
          take: 1,
        },
      },
      take: 50,
    });
    return products;
  }
}
