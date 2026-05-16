import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProductStatus } from '@prisma/client';
import { webStoreProductWhere } from '../helpers/product-catalog.util.js';

@Injectable()
export class ProductStorefrontService {
  constructor(private readonly prisma: PrismaService) {}
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

  async getSitemapProducts() {
    return this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        isArchived: false,
        storeProducts: { some: webStoreProductWhere },
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
    where.storeProducts = { some: webStoreProductWhere };

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
          where: webStoreProductWhere,
          include: { productVariant: { select: { image: true } } },
          take: 1,
        },
      },
      take: 50,
    });
    return products;
  }
}
