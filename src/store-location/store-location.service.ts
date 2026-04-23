import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateStoreLocationDto } from './dto/create-store-location.dto.js';
import { UpdateStoreLocationDto } from './dto/update-store-location.dto.js';

@Injectable()
export class StoreLocationService {
  constructor(private readonly prisma: PrismaService) {}

  findPublic() {
    return this.prisma.storeLocation.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  findAll() {
    return this.prisma.storeLocation.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  create(dto: CreateStoreLocationDto) {
    return this.prisma.storeLocation.create({
      data: {
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        hours: dto.hours,
        mapUrl: dto.mapUrl,
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateStoreLocationDto) {
    const row = await this.prisma.storeLocation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Location not found');
    return this.prisma.storeLocation.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const row = await this.prisma.storeLocation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Location not found');
    return this.prisma.storeLocation.delete({ where: { id } });
  }
}
