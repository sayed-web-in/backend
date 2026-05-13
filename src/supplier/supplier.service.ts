import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { QuickPaymentDto } from './dto/quick-payment.dto.js';
import {
  Prisma,
  PurchaseStatus,
  SupplierTransactionType,
  TransactionType,
} from '@prisma/client';
import type { SupplierQueryDto } from './dto/supplier-query.dto.js';
import {
  CreateSupplierTransactionDto,
  SupplierCustomTransactionType,
} from './dto/create-supplier-transaction.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: SupplierQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      sort,
      order = 'desc',
      isActive,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierWhereInput = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { company: { contains: search } },
        { phone: { contains: search } },
      ];
    }
    if (typeof isActive === 'boolean') where.isActive = isActive;

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          _count: { select: { purchases: true, batches: true } },
        },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async getSummary(query: SupplierQueryDto) {
    const where: Prisma.SupplierWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search } },
        { company: { contains: query.search } },
        { phone: { contains: query.search } },
      ];
    }
    if (typeof query.isActive === 'boolean') where.isActive = query.isActive;

    const [total, active, dueAgg] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.count({
        where: { AND: [where, { isActive: true }] },
      }),
      this.prisma.supplier.aggregate({ where, _sum: { totalDue: true } }),
    ]);

    return {
      total,
      active,
      totalDue: Number(dueAgg._sum.totalDue ?? 0),
    };
  }

  async findOne(id: number) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { branch: true },
        },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  /** Seller-admin compatible: advance balance + aggregates for purchase screen. */
  async getStats(id: number) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        advanceBalance: true,
        totalDue: true,
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const purchaseAgg = await this.prisma.purchase.aggregate({
      where: { supplierId: id },
      _sum: { grandTotal: true, paidAmount: true },
    });

    return {
      advance: Number(supplier.advanceBalance),
      totalDue: Number(supplier.totalDue),
      totalPurchase: Number(purchaseAgg._sum.grandTotal ?? 0),
      totalPaid: Number(purchaseAgg._sum.paidAmount ?? 0),
    };
  }

  async create(dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: dto });
  }

  async update(id: number, dto: UpdateSupplierDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.prisma.supplier.delete({ where: { id } });
  }

  async listTransactions(supplierId: number, query: PaginationDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 16));
    const skip = (page - 1) * limit;

    const where = { supplierId };
    const [rows, total] = await Promise.all([
      this.prisma.supplierTransaction.findMany({
        where,
        orderBy: [
          { createdAt: 'desc' },
          { transactionDate: 'desc' },
          { id: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          account: { select: { id: true, name: true, type: true } },
          purchase: { select: { id: true, referenceNo: true } },
        },
      }),
      this.prisma.supplierTransaction.count({ where }),
    ]);

    const data = rows.map((row) => ({
      id: row.id,
      type: String(row.type).toLowerCase(),
      amount: Number(row.amount),
      accountId: row.accountId,
      offsetsOpeningInventory: row.offsetsOpeningInventory,
      invoiceNo: row.invoiceNo,
      purchaseId: row.purchaseId,
      note: row.note,
      transactionDate: row.transactionDate.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      account: row.account
        ? {
            id: row.account.id,
            accountName: row.account.name,
            accountType: String(row.account.type),
          }
        : null,
      purchase: row.purchase
        ? {
            id: row.purchase.id,
            referenceNo: row.purchase.referenceNo,
          }
        : null,
    }));

    const paged = paginate(data, total, page, limit);
    return { ...paged, totalPages: paged.lastPage, limit };
  }

  async addCustomTransaction(
    supplierId: number,
    dto: CreateSupplierTransactionDto,
  ) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    if (
      dto.offsetsOpeningInventory &&
      dto.type !== SupplierCustomTransactionType.due
    ) {
      throw new BadRequestException(
        'offsetsOpeningInventory is only allowed when type is due',
      );
    }

    const oiDue =
      dto.type === SupplierCustomTransactionType.due &&
      dto.offsetsOpeningInventory === true;

    if (oiDue && dto.purchaseId != null) {
      throw new BadRequestException(
        'purchaseId must not be set for opening-stock funded supplier due',
      );
    }

    if (!oiDue && (!dto.accountId || dto.accountId < 1)) {
      throw new BadRequestException('accountId is required for this transaction');
    }

    const amount = new Prisma.Decimal(dto.amount);

    if (dto.purchaseId) {
      const purchase = await this.prisma.purchase.findFirst({
        where: { id: dto.purchaseId, supplierId },
      });
      if (!purchase) {
        throw new NotFoundException(
          'Purchase not found for this supplier',
        );
      }
    }

    let account: { id: number; balance: Prisma.Decimal } | null = null;
    if (!oiDue) {
      const acc = await this.prisma.account.findUnique({
        where: { id: dto.accountId! },
      });
      if (!acc) throw new NotFoundException('Account not found');
      if (!acc.isActive) {
        throw new BadRequestException('Account is inactive');
      }
      account = acc;
    }

    // Seller-admin account delta: advance → −amount, due → +amount (non-OI).
    let balanceDelta = new Prisma.Decimal(0);
    if (!oiDue) {
      if (dto.type === SupplierCustomTransactionType.advance) {
        balanceDelta = amount.negated();
        const bal = new Prisma.Decimal(account!.balance);
        if (amount.gt(bal)) {
          throw new BadRequestException('Insufficient account balance');
        }
      } else {
        balanceDelta = amount;
      }
    }

    const postedAt = dto.transactionDate
      ? new Date(dto.transactionDate)
      : new Date();
    if (Number.isNaN(postedAt.getTime())) {
      throw new BadRequestException('Invalid transactionDate');
    }

    const prismaType =
      dto.type === SupplierCustomTransactionType.advance
        ? SupplierTransactionType.ADVANCE
        : SupplierTransactionType.DUE;

    let note = dto.note?.trim() || null;
    if (oiDue) {
      note = note
        ? `${note} · Opening stock (inventory capital)`
        : 'Opening stock (inventory capital)';
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.supplierTransaction.create({
        data: {
          supplierId,
          type: prismaType,
          amount,
          accountId: oiDue ? null : dto.accountId!,
          offsetsOpeningInventory: oiDue,
          invoiceNo: dto.invoiceNo?.trim() || null,
          purchaseId: dto.purchaseId ?? null,
          note,
          transactionDate: postedAt,
        },
        include: {
          account: { select: { id: true, name: true, type: true } },
        },
      });

      if (!oiDue && account) {
        await tx.account.update({
          where: { id: account.id },
          data: { balance: { increment: balanceDelta } },
        });

        await tx.transaction.create({
          data: {
            accountId: dto.accountId!,
            type:
              dto.type === SupplierCustomTransactionType.advance
                ? TransactionType.DEBIT
                : TransactionType.CREDIT,
            amount,
            reference: `SUP-TXN-${supplierId}-${row.id}`,
            description:
              note ??
              (dto.type === SupplierCustomTransactionType.advance
                ? `Supplier advance - ${supplier.name}`
                : `Supplier due - ${supplier.name}`),
            createdAt: postedAt,
          },
        });
      }

      if (dto.type === SupplierCustomTransactionType.advance) {
        await tx.supplier.update({
          where: { id: supplierId },
          data: { advanceBalance: { increment: amount } },
        });
      } else {
        await tx.supplier.update({
          where: { id: supplierId },
          data: { totalDue: { increment: amount } },
        });
      }

      return row;
    });
  }

  async addQuickPayment(supplierId: number, dto: QuickPaymentDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const amount = new Prisma.Decimal(dto.amount);
    const totalDue = new Prisma.Decimal(supplier.totalDue);
    if (amount.gt(totalDue)) {
      throw new BadRequestException(
        `Amount cannot exceed total due (${totalDue})`,
      );
    }

    const account = await this.prisma.account.findUnique({
      where: { id: dto.paymentAccountId },
    });
    if (!account) throw new NotFoundException('Account not found');
    if (!account.isActive) {
      throw new BadRequestException('Account is inactive');
    }
    const balance = new Prisma.Decimal(account.balance);
    if (amount.gt(balance)) {
      throw new BadRequestException('Insufficient account balance');
    }

    const postedAt = dto.paymentDate ? new Date(dto.paymentDate) : undefined;
    if (postedAt !== undefined && Number.isNaN(postedAt.getTime())) {
      throw new BadRequestException('Invalid paymentDate');
    }

    const payDate = postedAt ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      // FIFO against purchase invoices (seller-admin quick-payment behaviour).
      const duePurchases = await tx.purchase.findMany({
        where: {
          supplierId,
          dueAmount: { gt: 0 },
          status: { not: PurchaseStatus.RETURNED },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          referenceNo: true,
          grandTotal: true,
          paidAmount: true,
          dueAmount: true,
        },
      });

      let remaining = new Prisma.Decimal(amount);
      const refParts: string[] = [];
      const noteExtra = dto.note?.trim() ?? '';

      for (const p of duePurchases) {
        if (remaining.lte(0)) break;
        const due = new Prisma.Decimal(p.dueAmount);
        if (due.lte(0)) continue;

        const apply = Prisma.Decimal.min(remaining, due);
        const newPaid = new Prisma.Decimal(p.paidAmount).add(apply);
        let newDue = new Prisma.Decimal(p.grandTotal).sub(newPaid);
        if (newDue.lt(0)) newDue = new Prisma.Decimal(0);

        const nextStatus: PurchaseStatus = newDue.lte(0)
          ? PurchaseStatus.RECEIVED
          : PurchaseStatus.PARTIAL;

        await tx.purchase.update({
          where: { id: p.id },
          data: {
            paidAmount: newPaid,
            dueAmount: newDue,
            status: nextStatus,
          },
        });

        await tx.supplierTransaction.create({
          data: {
            supplierId,
            type: SupplierTransactionType.PAYMENT,
            amount: apply,
            accountId: dto.paymentAccountId,
            purchaseId: p.id,
            invoiceNo: null,
            note: noteExtra
              ? `Quick payment (FIFO) — ${p.referenceNo} · ${noteExtra}`
              : `Quick payment (FIFO) — ${p.referenceNo}`,
            transactionDate: payDate,
            offsetsOpeningInventory: false,
          },
        });

        refParts.push(p.referenceNo);
        remaining = remaining.sub(apply);
      }

      if (remaining.gt(0)) {
        await tx.supplierTransaction.create({
          data: {
            supplierId,
            type: SupplierTransactionType.PAYMENT,
            amount: remaining,
            accountId: dto.paymentAccountId,
            purchaseId: null,
            invoiceNo: null,
            note: noteExtra
              ? `Quick payment (custom due) · ${noteExtra}`
              : `Quick payment (custom due)`,
            transactionDate: payDate,
            offsetsOpeningInventory: false,
          },
        });
      }

      await tx.supplier.update({
        where: { id: supplierId },
        data: { totalDue: { decrement: amount } },
      });

      const ref =
        refParts.length > 0
          ? `SUP-PAY-${supplierId}:${refParts.slice(0, 3).join(',')}`
          : `SUP-PAY-${supplierId}-${Date.now()}`;

      await tx.transaction.create({
        data: {
          accountId: dto.paymentAccountId,
          type: 'DEBIT',
          amount,
          reference: ref.slice(0, 120),
          description: dto.note ?? `Supplier quick payment (FIFO) - ${supplier.name}`,
          ...(postedAt ? { createdAt: postedAt } : {}),
        },
      });

      await tx.account.update({
        where: { id: dto.paymentAccountId },
        data: { balance: { decrement: amount } },
      });

      return tx.supplier.findUnique({ where: { id: supplierId } });
    });
  }
}
