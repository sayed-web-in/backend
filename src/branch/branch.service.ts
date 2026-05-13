import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBranchDto } from './dto/create-branch.dto.js';
import { UpdateBranchDto } from './dto/update-branch.dto.js';

/** Single-branch tenant: at most one row; the last branch cannot be deleted. */
const MAX_BRANCHES = 1;

@Injectable()
export class BranchService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.branch.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: number) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async create(dto: CreateBranchDto) {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.branch.count();
      if (count >= MAX_BRANCHES) {
        throw new BadRequestException(
          'Only one branch is allowed. Edit your existing branch instead of adding another.',
        );
      }
      return tx.branch.create({ data: dto });
    });
  }

  async update(id: number, dto: UpdateBranchDto) {
    await this.findOne(id);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.findOne(id);
    const count = await this.prisma.branch.count();
    if (count <= 1) {
      throw new BadRequestException(
        'The last branch cannot be deleted. Create another branch first, or keep this one.',
      );
    }
    return this.prisma.branch.delete({ where: { id } });
  }
}
