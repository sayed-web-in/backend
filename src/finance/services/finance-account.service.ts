import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateAccountDto } from '../dto/create-account.dto.js';
import { CreateTransactionDto } from '../dto/create-transaction.dto.js';
import { TransferFundsDto } from '../dto/transfer-funds.dto.js';
import { FinanceQueryDto } from '../dto/finance-query.dto.js';
import { paginate } from '../../common/pagination.dto.js';
import { bdDayEndUtc, bdDayStartUtc } from '../../common/bd-time.js';

@Injectable()
export class FinanceAccountService {
  constructor(private readonly prisma: PrismaService) {}
  async getAccounts() {
    return this.prisma.account.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { transactions: true } } },
    });
  }

  async createAccount(dto: CreateAccountDto) {
    const opening = new Prisma.Decimal(
      dto.openingBalance ?? dto.balance ?? 0,
    );
    return this.prisma.account.create({
      data: {
        name: dto.name,
        accountNumber: dto.accountNumber,
        type: dto.type,
        openingBalance: opening,
        balance: opening,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateAccount(id: number, dto: Partial<CreateAccountDto>) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Account not found');

    const data: Prisma.AccountUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.accountNumber !== undefined)
      data.accountNumber = dto.accountNumber;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.openingBalance !== undefined) {
      const newOp = new Prisma.Decimal(dto.openingBalance);
      const oldOp = new Prisma.Decimal(account.openingBalance);
      const delta = newOp.sub(oldOp);
      data.openingBalance = newOp;
      data.balance = new Prisma.Decimal(account.balance).add(delta);
    } else if (dto.balance !== undefined) {
      data.balance = new Prisma.Decimal(dto.balance);
    }

    return this.prisma.account.update({ where: { id }, data });
  }

  async deleteAccount(id: number) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Account not found');
    return this.prisma.account.delete({ where: { id } });
  }

  // ─── TRANSACTIONS ──────────────────────────────────────────

  async getTransactions(query: FinanceQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      accountId,
      type,
      dateFrom,
      dateTo,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { reference: { contains: search } },
        { description: { contains: search } },
      ];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.createdAt.lte = bdDayEndUtc(dateTo);
    }

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { account: true },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async createTransaction(dto: CreateTransactionDto) {
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });
    if (!account) throw new NotFoundException('Account not found');

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          accountId: dto.accountId,
          type: dto.type,
          amount: dto.amount,
          reference: dto.reference,
          description: dto.description,
        },
        include: { account: true },
      });

      const balanceUpdate =
        dto.type === 'CREDIT'
          ? { increment: new Prisma.Decimal(dto.amount) }
          : { decrement: new Prisma.Decimal(dto.amount) };

      await tx.account.update({
        where: { id: dto.accountId },
        data: { balance: balanceUpdate },
      });

      return transaction;
    });
  }

  async transferFunds(dto: TransferFundsDto) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException(
        'Source and destination accounts must be different',
      );
    }

    const decAmount = new Prisma.Decimal(dto.amount);
    if (decAmount.lte(0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    return this.prisma.$transaction(async (tx) => {
      const from = await tx.account.findUnique({
        where: { id: dto.fromAccountId },
      });
      const to = await tx.account.findUnique({
        where: { id: dto.toAccountId },
      });
      if (!from || !to) {
        throw new NotFoundException('Account not found');
      }

      const available = new Prisma.Decimal(from.balance);
      if (available.lessThan(decAmount)) {
        throw new BadRequestException(
          'Insufficient balance in the source account',
        );
      }

      const ref =
        dto.reference?.trim() ||
        `TRF-${Date.now().toString(36).toUpperCase()}`;
      const note = dto.description?.trim();
      const debitDesc = note || `Transfer to ${to.name}`;
      const creditDesc = note || `Transfer from ${from.name}`;

      await tx.transaction.create({
        data: {
          accountId: dto.fromAccountId,
          type: 'DEBIT',
          amount: decAmount,
          reference: ref,
          description: debitDesc,
        },
      });
      await tx.account.update({
        where: { id: dto.fromAccountId },
        data: { balance: { decrement: decAmount } },
      });

      await tx.transaction.create({
        data: {
          accountId: dto.toAccountId,
          type: 'CREDIT',
          amount: decAmount,
          reference: ref,
          description: creditDesc,
        },
      });
      await tx.account.update({
        where: { id: dto.toAccountId },
        data: { balance: { increment: decAmount } },
      });

      return { reference: ref };
    });
  }

  // ─── EXPENSE CATEGORIES ────────────────────────────────────
}
