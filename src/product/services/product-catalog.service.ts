import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateProductDto } from '../dto/create-product.dto.js';
import { UpdateProductDto } from '../dto/update-product.dto.js';
import {
  ProductQueryDto,
} from '../dto/product-query.dto.js';
import { PaginationDto, paginate } from '../../common/pagination.dto.js';
import { Prisma, ProductType, ProductStatus } from '@prisma/client';
import {
  webStoreProductWhere,
  toUploadsFsPath,
  deleteUploadFiles,
  generateSlug,
  generateSku,
  generateBarcode,
} from '../helpers/product-catalog.util.js';

@Injectable()
export class ProductCatalogService {
  constructor(private readonly prisma: PrismaService) {}
  async create(dto: CreateProductDto) {
    const { images, specifications, variants, ...data } = dto;

    let slug = generateSlug(data.name);
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
                  sku: v.sku?.trim() || generateSku('VAR'),
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
        { variants: { some: { sku: { contains: search } } } },
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
        Object.assign(storeWhere, webStoreProductWhere);
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
            where: {
              ...(useWebCatalog ? webStoreProductWhere : {}),
              ...(branchId ? { branchId } : {}),
            },
            include: {
              branch: true,
              productVariant: {
                select: {
                  id: true,
                  sku: true,
                  image: true,
                  attributes: {
                    select: {
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
            },
            take: branchId ? 50 : 5,
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
          ...(forWebsite ? { where: webStoreProductWhere } : {}),
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
              where: webStoreProductWhere,
              include: { branch: true },
            },
          },
        },
        storeProducts: {
          where: webStoreProductWhere,
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

    await deleteUploadFiles([...obsoleteImageUrls, ...obsoleteVariantImageUrls]);

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
            sku: v.sku?.trim() || generateSku('VAR'),
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
          sku: v.sku?.trim() || generateSku('VAR'),
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

}
