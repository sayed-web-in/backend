import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';
import { CreateShortFeatureDto } from './dto/create-short-feature.dto.js';
import { UpdateShortFeatureDto } from './dto/update-short-feature.dto.js';

@Injectable()
export class ShortFeatureService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 50, search } = query;
    const skip = (page - 1) * limit;

    const where: { title?: { contains: string } } = {};
    if (search) where.title = { contains: search };

    const [data, total] = await Promise.all([
      this.prisma.shortFeature.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.shortFeature.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const item = await this.prisma.shortFeature.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Short feature not found');
    return item;
  }

  async create(dto: CreateShortFeatureDto) {
    return this.prisma.shortFeature.create({
      data: {
        title: dto.title,
        description: dto.description,
        icon: dto.icon,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateShortFeatureDto) {
    await this.findOne(id);
    return this.prisma.shortFeature.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.shortFeature.delete({ where: { id } });
  }
}
