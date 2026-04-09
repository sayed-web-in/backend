import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { AddToStoreDto } from './dto/add-to-store.dto.js';
import { ProductQueryDto, StoreProductQueryDto } from './dto/product-query.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';
import { ProductType } from '@prisma/client';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

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

  private generateBatchNumber(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `BATCH-${ts}-${rand}`;
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
          ? { create: images.map((img) => ({ url: img.url, sortOrder: img.sortOrder ?? 0 })) }
          : undefined,
        specifications: specifications?.length
          ? { create: specifications.map((s) => ({ name: s.name, value: s.value })) }
          : undefined,
        variants:
          data.type === ProductType.VARIABLE && variants?.length
            ? {
                create: variants.map((v) => ({
                  sku: this.generateSku('VAR'),
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
        variants: { include: { attributes: { include: { attributeValue: true } } } },
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

    if (product.hasImei && (!dto.serialNumbers || dto.serialNumbers.length !== dto.quantity)) {
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
          sellingPrice: dto.sellingPrice,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          quantityAlert: dto.quantityAlert ?? 5,
          sellingType: dto.sellingType ?? 'BOTH',
          isBestDeal: dto.isBestDeal ?? false,
          isFeatured: dto.isFeatured ?? false,
        },
      });

      const batchNumber = this.generateBatchNumber();
      const barcode = this.generateBarcode();

      const batch = await tx.batch.create({
        data: {
          batchNumber,
          barcode,
          initialQty: dto.quantity,
          availableQty: dto.quantity,
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
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = { isArchived: false };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (subCategoryId) where.subCategoryId = subCategoryId;
    if (brandId) where.brandId = brandId;
    if (status) where.status = status;

    if (isBestDeal !== undefined || isFeatured !== undefined || priceMin || priceMax || branchId || sellingType) {
      const storeWhere: any = {};
      if (isBestDeal !== undefined) storeWhere.isBestDeal = isBestDeal;
      if (isFeatured !== undefined) storeWhere.isFeatured = isFeatured;
      if (priceMin || priceMax) {
        storeWhere.sellingPrice = {};
        if (priceMin) storeWhere.sellingPrice.gte = priceMin;
        if (priceMax) storeWhere.sellingPrice.lte = priceMax;
      }
      if (branchId) storeWhere.branchId = branchId;
      if (sellingType) storeWhere.sellingType = sellingType;
      where.storeProducts = { some: storeWhere };
    }

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
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
          storeProducts: {
            include: { branch: true },
            take: 5,
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
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
          },
        },
        storeProducts: {
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
    const product = await this.prisma.product.findUnique({
      where: { slug },
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
              where: { isActive: true },
              include: { branch: true },
            },
          },
        },
        storeProducts: {
          where: { isActive: true },
          include: { branch: true },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: number, dto: UpdateProductDto) {
    await this.findOne(id);
    const { images, specifications, variants, ...data } = dto as CreateProductDto;

    if (images) {
      await this.prisma.productImage.deleteMany({ where: { productId: id } });
    }
    if (specifications) {
      await this.prisma.specification.deleteMany({ where: { productId: id } });
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        images: images
          ? { create: images.map((img) => ({ url: img.url, sortOrder: img.sortOrder ?? 0 })) }
          : undefined,
        specifications: specifications
          ? { create: specifications.map((s) => ({ name: s.name, value: s.value })) }
          : undefined,
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
            attributes: { include: { attributeValue: true } },
          },
        },
      },
    });
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

  async getStoreProducts(query: StoreProductQueryDto) {
    const { page = 1, limit = 16, search, branchId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (search) {
      where.product = {
        OR: [
          { name: { contains: search } },
          { sku: { contains: search } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.storeProduct.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { include: { images: { take: 1, orderBy: { sortOrder: 'asc' } } } },
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

    return paginate(data, total, page, limit);
  }

  async getDraftProducts(query: PaginationDto) {
    const { page = 1, limit = 16, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { status: 'DRAFT', isArchived: false };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
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
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getLowStock(query: StoreProductQueryDto) {
    const { page = 1, limit = 16, branchId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) where.branchId = branchId;

    const allLow = await this.prisma.storeProduct.findMany({
      where,
      include: {
        product: { include: { images: { take: 1, orderBy: { sortOrder: 'asc' } } } },
        branch: true,
        productVariant: true,
      },
    });

    const filtered = allLow.filter((sp) => sp.quantity <= sp.quantityAlert);
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

  async getSitemapProducts() {
    return this.prisma.product.findMany({
      where: { status: 'ACTIVE', isArchived: false },
      select: { slug: true, updatedAt: true },
    });
  }

  async search(query: string, categoryId?: number) {
    const where: any = {
      status: 'ACTIVE',
      isArchived: false,
      OR: [
        { name: { contains: query } },
        { description: { contains: query } },
      ],
    };
    if (categoryId) where.categoryId = categoryId;

    const products = await this.prisma.product.findMany({
      where,
      include: {
        images: { take: 1, orderBy: { sortOrder: 'asc' } },
        category: true,
        brand: true,
        storeProducts: {
          where: { isActive: true, sellingType: { in: ['ONLINE', 'BOTH'] } },
          take: 1,
        },
      },
      take: 50,
    });
    return products;
  }
}
