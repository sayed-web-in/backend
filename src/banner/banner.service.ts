import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BannerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBannerDto } from './dto/create-banner.dto.js';
import { UpdateBannerDto } from './dto/update-banner.dto.js';
import { unlink } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class BannerService {
  constructor(private prisma: PrismaService) {}

  private static readonly MAX_HERO_SMALL = 2;

  private async assertHeroSmallLimit(
    targetType: BannerType,
    excludeId?: number,
  ) {
    if (targetType !== BannerType.HERO_SMALL) return;
    const count = await this.prisma.banner.count({
      where: {
        type: BannerType.HERO_SMALL,
        ...(excludeId != null ? { id: { not: excludeId } } : {}),
      },
    });
    if (count >= BannerService.MAX_HERO_SMALL) {
      throw new BadRequestException(
        `Maximum ${BannerService.MAX_HERO_SMALL} Hero Small banners allowed`,
      );
    }
  }

  private toUploadsFsPath(url?: string | null): string | null {
    if (!url) return null;
    let pathPart = url.trim();
    if (!pathPart) return null;

    if (/^https?:\/\//i.test(pathPart)) {
      try {
        const parsed = new URL(pathPart);
        pathPart = parsed.pathname || '';
      } catch {
        return null;
      }
    }

    if (!pathPart.startsWith('/uploads/')) return null;

    const decoded = decodeURIComponent(pathPart).replace(/\\/g, '/');
    const relative = decoded.replace(/^\/+/, '');
    if (relative.includes('..')) return null;

    return join(process.cwd(), relative);
  }

  private async deleteUploadFile(url?: string | null) {
    const path = this.toUploadsFsPath(url);
    if (!path) return;
    try {
      await unlink(path);
    } catch {
      // Best-effort cleanup; ignore missing/locked files.
    }
  }

  async findAll(type?: BannerType) {
    const where = type ? { type } : {};
    return this.prisma.banner.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: number) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  }

  async create(dto: CreateBannerDto) {
    await this.assertHeroSmallLimit(dto.type);
    return this.prisma.banner.create({
      data: {
        title: dto.title,
        image: dto.image,
        link: dto.link,
        type: dto.type,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateBannerDto) {
    const existing = await this.findOne(id);
    const targetType = dto.type ?? existing.type;
    await this.assertHeroSmallLimit(targetType, id);
    const updated = await this.prisma.banner.update({
      where: { id },
      data: dto,
    });
    if (dto.image && dto.image !== existing.image) {
      await this.deleteUploadFile(existing.image);
    }
    return updated;
  }

  async remove(id: number) {
    const existing = await this.findOne(id);
    const deleted = await this.prisma.banner.delete({ where: { id } });
    await this.deleteUploadFile(existing.image);
    return deleted;
  }
}
