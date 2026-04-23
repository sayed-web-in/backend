import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';
import { CreateFaqDto } from './dto/create-faq.dto.js';
import { UpdateFaqDto } from './dto/update-faq.dto.js';

@Injectable()
export class FaqService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 50, search } = query;
    const skip = (page - 1) * limit;

    const where: { question?: { contains: string } } = {};
    if (search) where.question = { contains: search };

    const [data, total] = await Promise.all([
      this.prisma.faq.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.faq.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const faq = await this.prisma.faq.findUnique({ where: { id } });
    if (!faq) throw new NotFoundException('FAQ not found');
    return faq;
  }

  async create(dto: CreateFaqDto) {
    return this.prisma.faq.create({
      data: {
        question: dto.question,
        answer: dto.answer,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateFaqDto) {
    await this.findOne(id);
    return this.prisma.faq.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.faq.delete({ where: { id } });
  }
}
