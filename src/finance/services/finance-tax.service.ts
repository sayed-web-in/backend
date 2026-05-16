import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateTaxRateDto } from '../dto/create-tax-rate.dto.js';

@Injectable()
export class FinanceTaxService {
  constructor(private readonly prisma: PrismaService) {}
  async getTaxRates() {
    return this.prisma.taxRate.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createTaxRate(dto: CreateTaxRateDto) {
    return this.prisma.taxRate.create({
      data: {
        name: dto.name,
        rate: dto.rate,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateTaxRate(id: number, dto: Partial<CreateTaxRateDto>) {
    const taxRate = await this.prisma.taxRate.findUnique({ where: { id } });
    if (!taxRate) throw new NotFoundException('Tax rate not found');
    return this.prisma.taxRate.update({ where: { id }, data: dto });
  }

  async deleteTaxRate(id: number) {
    const taxRate = await this.prisma.taxRate.findUnique({ where: { id } });
    if (!taxRate) throw new NotFoundException('Tax rate not found');
    return this.prisma.taxRate.delete({ where: { id } });
  }
}
