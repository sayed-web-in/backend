import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBrandDto } from './dto/create-brand.dto.js';
import { UpdateBrandDto } from './dto/update-brand.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';

@Injectable()
export class BrandService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 16, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.name = { contains: search };
    }

    const [data, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { products: true } },
          branches: { include: { branch: true } },
        },
      }),
      this.prisma.brand.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      include: {
        branches: { include: { branch: true } },
      },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async create(dto: CreateBrandDto) {
    const { branchIds, ...data } = dto;

    return this.prisma.brand.create({
      data: {
        ...data,
        branches: branchIds?.length
          ? { create: branchIds.map((branchId) => ({ branchId })) }
          : undefined,
      },
      include: {
        branches: { include: { branch: true } },
      },
    });
  }

  async update(id: number, dto: UpdateBrandDto) {
    await this.findOne(id);
    const { branchIds, ...data } = dto;

    if (branchIds) {
      await this.prisma.brandBranch.deleteMany({ where: { brandId: id } });
    }

    return this.prisma.brand.update({
      where: { id },
      data: {
        ...data,
        branches: branchIds
          ? { create: branchIds.map((branchId) => ({ branchId })) }
          : undefined,
      },
      include: {
        branches: { include: { branch: true } },
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.brand.delete({ where: { id } });
  }
}
