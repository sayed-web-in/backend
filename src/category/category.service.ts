import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';
import { CreateSubCategoryDto } from './dto/create-subcategory.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 16, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.name = { contains: search };
    }

    const [data, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        skip,
        take: limit,
        orderBy: { displayOrder: 'asc' },
        include: {
          subcategories: {
            orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
          },
          _count: { select: { subcategories: true } },
          branches: { include: { branch: true } },
        },
      }),
      this.prisma.category.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        subcategories: {
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        },
        branches: { include: { branch: true } },
      },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(dto: CreateCategoryDto) {
    const { branchIds, ...data } = dto;

    return this.prisma.category.create({
      data: {
        ...data,
        branches: branchIds?.length
          ? { create: branchIds.map((branchId) => ({ branchId })) }
          : undefined,
      },
      include: {
        subcategories: true,
        branches: { include: { branch: true } },
      },
    });
  }

  async update(id: number, dto: UpdateCategoryDto) {
    await this.findOne(id);
    const { branchIds, ...data } = dto;

    if (branchIds) {
      await this.prisma.categoryBranch.deleteMany({
        where: { categoryId: id },
      });
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        ...data,
        branches: branchIds
          ? { create: branchIds.map((branchId) => ({ branchId })) }
          : undefined,
      },
      include: {
        subcategories: true,
        branches: { include: { branch: true } },
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.category.delete({ where: { id } });
  }

  async addSubCategory(categoryId: number, dto: CreateSubCategoryDto) {
    await this.findOne(categoryId);
    return this.prisma.subCategory.create({
      data: { ...dto, categoryId },
    });
  }

  async updateSubCategory(id: number, dto: CreateSubCategoryDto) {
    const sub = await this.prisma.subCategory.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('SubCategory not found');
    return this.prisma.subCategory.update({ where: { id }, data: dto });
  }

  async removeSubCategory(id: number) {
    const sub = await this.prisma.subCategory.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('SubCategory not found');
    return this.prisma.subCategory.delete({ where: { id } });
  }
}
