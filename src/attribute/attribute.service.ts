import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAttributeDto } from './dto/create-attribute.dto.js';
import { UpdateAttributeDto } from './dto/update-attribute.dto.js';
import { CreateAttributeValueDto } from './dto/create-attribute-value.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';

@Injectable()
export class AttributeService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 16, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.name = { contains: search };
    }

    const [data, total] = await Promise.all([
      this.prisma.attribute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { values: true },
      }),
      this.prisma.attribute.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const attribute = await this.prisma.attribute.findUnique({
      where: { id },
      include: { values: true },
    });
    if (!attribute) throw new NotFoundException('Attribute not found');
    return attribute;
  }

  async create(dto: CreateAttributeDto) {
    const { values, ...data } = dto;

    return this.prisma.attribute.create({
      data: {
        ...data,
        values: values?.length
          ? { create: values.map((v) => ({ value: v.value })) }
          : undefined,
      },
      include: { values: true },
    });
  }

  async update(id: number, dto: UpdateAttributeDto) {
    await this.findOne(id);
    const { values, ...scalar } = dto;

    if (values !== undefined) {
      await this.prisma.attributeValue.deleteMany({ where: { attributeId: id } });
    }

    return this.prisma.attribute.update({
      where: { id },
      data: {
        ...scalar,
        ...(values !== undefined && values.length > 0
          ? { values: { create: values.map((v) => ({ value: v.value })) } }
          : {}),
      },
      include: { values: true },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.attribute.delete({ where: { id } });
  }

  async addValue(attributeId: number, dto: CreateAttributeValueDto) {
    await this.findOne(attributeId);
    return this.prisma.attributeValue.create({
      data: { value: dto.value, attributeId },
    });
  }

  async removeValue(id: number) {
    const value = await this.prisma.attributeValue.findUnique({ where: { id } });
    if (!value) throw new NotFoundException('Attribute value not found');
    return this.prisma.attributeValue.delete({ where: { id } });
  }
}
