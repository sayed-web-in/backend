import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { paginate } from '../common/pagination.dto.js';
import { CreateTermsAndConditionDto } from './dto/create-terms-and-condition.dto.js';
import { UpdateTermsAndConditionDto } from './dto/update-terms-and-condition.dto.js';
import type { TermsAndConditionQueryDto } from './dto/terms-and-condition-query.dto.js';

@Injectable()
export class TermsAndConditionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: TermsAndConditionQueryDto) {
    const { page = 1, limit = 50, search, isActive } = query;
    const skip = (page - 1) * limit;

    const where: {
      isActive?: boolean;
      OR?: Array<{ title?: { contains: string }; description?: { contains: string } }>;
    } = {};

    if (typeof isActive === 'boolean') {
      where.isActive = isActive;
    }

    if (search?.trim()) {
      const s = search.trim();
      where.OR = [{ title: { contains: s } }, { description: { contains: s } }];
    }

    const [data, total, activeCount, inactiveCount] = await Promise.all([
      this.prisma.termsAndCondition.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.termsAndCondition.count({ where }),
      this.prisma.termsAndCondition.count({ where: { ...where, isActive: true } }),
      this.prisma.termsAndCondition.count({ where: { ...where, isActive: false } }),
    ]);

    return {
      ...paginate(data, total, page, limit),
      stats: {
        total,
        active: activeCount,
        inactive: inactiveCount,
      },
    };
  }

  async create(dto: CreateTermsAndConditionDto) {
    return this.prisma.termsAndCondition.create({
      data: {
        title: dto.title.trim(),
        description: dto.description,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateTermsAndConditionDto) {
    const row = await this.prisma.termsAndCondition.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Terms & conditions not found');

    return this.prisma.termsAndCondition.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(id: number) {
    const row = await this.prisma.termsAndCondition.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Terms & conditions not found');

    return this.prisma.termsAndCondition.delete({ where: { id } });
  }
}
