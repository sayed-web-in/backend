import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateArticleDto } from './dto/create-article.dto.js';
import { UpdateArticleDto } from './dto/update-article.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';

@Injectable()
export class ArticleService {
  constructor(private prisma: PrismaService) {}

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    const existing = await this.prisma.article.findUnique({ where: { slug } });
    if (existing) {
      const rand = Math.random().toString(36).substring(2, 6);
      slug = `${base}-${rand}`;
    }
    return slug;
  }

  async findAll(query: PaginationDto) {
    const { page = 1, limit = 16, search, sort, order = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: { title?: { contains: string } } = {};
    if (search) {
      where.title = { contains: search };
    }

    const orderBy: Record<string, 'asc' | 'desc'> = sort
      ? { [sort]: order }
      : { createdAt: order };

    const [data, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.article.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  async findBySlug(slug: string) {
    const article = await this.prisma.article.findUnique({ where: { slug } });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  async create(dto: CreateArticleDto) {
    const base = this.generateSlug(dto.title);
    const slug = await this.uniqueSlug(base);

    return this.prisma.article.create({
      data: {
        title: dto.title,
        slug,
        content: dto.content,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: number, dto: UpdateArticleDto) {
    await this.findOne(id);
    return this.prisma.article.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.article.delete({ where: { id } });
  }
}
