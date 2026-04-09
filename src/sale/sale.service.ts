import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSaleDto } from './dto/create-sale.dto.js';
import { CompletePaylaterDto } from './dto/complete-paylater.dto.js';
import { CreateSaleReturnDto } from './dto/create-sale-return.dto.js';
import { SaleQueryDto } from './dto/sale-query.dto.js';
import { PaginationDto, paginate } from '../common/pagination.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class SaleService {
  constructor(private prisma: PrismaService) {}

  private generateInvoiceNumber(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV-${ts}-${rand}`;
  }

  async createSale(dto: CreateSaleDto) {
    return this.prisma.$transaction(async (tx) => {
      const invoiceNumber = this.generateInvoiceNumber();

      let totalAmount = new Prisma.Decimal(0);
      for (const item of dto.items) {
        const itemTotal = item.unitPrice * item.quantity - (item.discount ?? 0);
        totalAmount = totalAmount.add(new Prisma.Decimal(itemTotal));
      }

      const discount = new Prisma.Decimal(dto.discount ?? 0);
      const tax = new Prisma.Decimal(dto.tax ?? 0);
      const grandTotal = totalAmount.sub(discount).add(tax);

      const status = dto.status ?? 'COMPLETED';
      const paidAmount = new Prisma.Decimal(
        status === 'PAY_LATER' ? 0 : grandTotal.toNumber(),
      );
      const dueAmount =
        status === 'PAY_LATER' ? grandTotal : new Prisma.Decimal(0);
      const changeAmount = paidAmount.sub(grandTotal).greaterThan(0)
        ? paidAmount.sub(grandTotal)
        : new Prisma.Decimal(0);

      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          customerId: dto.customerId,
          branchId: dto.branchId,
          totalAmount,
          discount,
          tax,
          grandTotal,
          paidAmount,
          changeAmount,
          dueAmount,
          paymentMethod: dto.paymentMethod,
          paymentAccountId: dto.paymentAccountId,
          status,
          note: dto.note,
        },
      });

      for (const item of dto.items) {
        const itemDiscount = new Prisma.Decimal(item.discount ?? 0);
        const itemTotal = new Prisma.Decimal(item.unitPrice * item.quantity).sub(
          itemDiscount,
        );

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            storeProductId: item.storeProductId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: itemDiscount,
            total: itemTotal,
          },
        });

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: { quantity: { decrement: item.quantity } },
        });

        const batch = await tx.batch.findFirst({
          where: {
            storeProductId: item.storeProductId,
            availableQty: { gt: 0 },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (batch) {
          const deductQty = Math.min(batch.availableQty, item.quantity);
          await tx.batch.update({
            where: { id: batch.id },
            data: {
              availableQty: { decrement: deductQty },
              soldQty: { increment: deductQty },
            },
          });
        }

        if (item.serialNumbers?.length) {
          await tx.serialNumber.updateMany({
            where: { serial: { in: item.serialNumbers } },
            data: { status: 'SOLD', saleItemId: saleItem.id },
          });
        }
      }

      if (dto.paymentAccountId && status === 'COMPLETED') {
        await tx.transaction.create({
          data: {
            accountId: dto.paymentAccountId,
            type: 'CREDIT',
            amount: grandTotal,
            reference: invoiceNumber,
            description: `Sale payment - ${invoiceNumber}`,
          },
        });

        await tx.account.update({
          where: { id: dto.paymentAccountId },
          data: { balance: { increment: grandTotal } },
        });
      }

      return tx.sale.findUnique({
        where: { id: sale.id },
        include: {
          items: {
            include: {
              storeProduct: {
                include: { product: true, productVariant: true },
              },
              serialNumbers: true,
            },
          },
          customer: true,
          branch: true,
          paymentAccount: true,
        },
      });
    });
  }

  async completePaylater(saleId: number, dto: CompletePaylaterDto) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.status !== 'PAY_LATER') {
      throw new BadRequestException('Sale is not in PAY_LATER status');
    }

    return this.prisma.$transaction(async (tx) => {
      const paidAmount = new Prisma.Decimal(dto.paidAmount);
      const changeAmount = paidAmount.sub(sale.grandTotal).greaterThan(0)
        ? paidAmount.sub(sale.grandTotal)
        : new Prisma.Decimal(0);
      const dueAmount = sale.grandTotal.sub(paidAmount).greaterThan(0)
        ? sale.grandTotal.sub(paidAmount)
        : new Prisma.Decimal(0);

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          status: 'COMPLETED',
          paidAmount,
          changeAmount,
          dueAmount,
          paymentMethod: dto.paymentMethod,
          paymentAccountId: dto.paymentAccountId,
        },
        include: {
          items: true,
          customer: true,
          branch: true,
          paymentAccount: true,
        },
      });

      if (dto.paymentAccountId) {
        await tx.transaction.create({
          data: {
            accountId: dto.paymentAccountId,
            type: 'CREDIT',
            amount: paidAmount,
            reference: sale.invoiceNumber,
            description: `Pay-later completion - ${sale.invoiceNumber}`,
          },
        });

        await tx.account.update({
          where: { id: dto.paymentAccountId },
          data: { balance: { increment: paidAmount } },
        });
      }

      return updated;
    });
  }

  async findAll(query: SaleQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      branchId,
      customerId,
      status,
      dateFrom,
      dateTo,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    if (search) {
      where.invoiceNumber = { contains: search };
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const orderBy: any = {};
    if (sort) {
      orderBy[sort] = order;
    } else {
      orderBy.createdAt = order;
    }

    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          customer: true,
          branch: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        customer: true,
        branch: true,
        paymentAccount: true,
        items: {
          include: {
            storeProduct: {
              include: {
                product: { include: { images: { take: 1, orderBy: { sortOrder: 'asc' } } } },
                productVariant: {
                  include: {
                    attributes: { include: { attributeValue: true } },
                  },
                },
              },
            },
            serialNumbers: true,
          },
        },
        returns: {
          include: { items: true },
        },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  async getPayLaterSales(query: PaginationDto) {
    const { page = 1, limit = 16, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { status: 'PAY_LATER' as const };
    if (search) {
      where.invoiceNumber = { contains: search };
    }

    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: true,
          branch: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async createReturn(dto: CreateSaleReturnDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: dto.saleId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    return this.prisma.$transaction(async (tx) => {
      let returnTotal = new Prisma.Decimal(0);
      const returnItemsData = dto.items.map((item) => {
        const itemTotal = new Prisma.Decimal(item.unitPrice * item.quantity);
        returnTotal = returnTotal.add(itemTotal);
        return {
          storeProductId: item.storeProductId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: itemTotal,
        };
      });

      const saleReturn = await tx.saleReturn.create({
        data: {
          saleId: dto.saleId,
          reason: dto.reason,
          totalAmount: returnTotal,
          items: { create: returnItemsData },
        },
        include: { items: true },
      });

      for (const item of dto.items) {
        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: { quantity: { increment: item.quantity } },
        });

        const batch = await tx.batch.findFirst({
          where: { storeProductId: item.storeProductId },
          orderBy: { createdAt: 'desc' },
        });

        if (batch) {
          const restoreQty = Math.min(batch.soldQty, item.quantity);
          await tx.batch.update({
            where: { id: batch.id },
            data: {
              availableQty: { increment: restoreQty },
              soldQty: { decrement: restoreQty },
              returnQty: { increment: restoreQty },
            },
          });
        }

        const saleItem = sale.items.find(
          (si) => si.storeProductId === item.storeProductId,
        );
        if (saleItem) {
          await tx.serialNumber.updateMany({
            where: { saleItemId: saleItem.id, status: 'SOLD' },
            data: { status: 'RETURNED', saleItemId: null },
          });
        }
      }

      const allReturnedQty = await this.getTotalReturnedQuantities(
        tx,
        dto.saleId,
      );
      const allSold = sale.items.every((si) => {
        const returned = allReturnedQty.get(si.storeProductId) ?? 0;
        return returned >= si.quantity;
      });

      await tx.sale.update({
        where: { id: dto.saleId },
        data: { status: allSold ? 'RETURNED' : 'PARTIAL_RETURN' },
      });

      if (sale.paymentAccountId) {
        await tx.transaction.create({
          data: {
            accountId: sale.paymentAccountId,
            type: 'DEBIT',
            amount: returnTotal,
            reference: sale.invoiceNumber,
            description: `Sale return - ${sale.invoiceNumber}`,
          },
        });

        await tx.account.update({
          where: { id: sale.paymentAccountId },
          data: { balance: { decrement: returnTotal } },
        });
      }

      return saleReturn;
    });
  }

  private async getTotalReturnedQuantities(
    tx: Prisma.TransactionClient,
    saleId: number,
  ): Promise<Map<number, number>> {
    const returns = await tx.saleReturn.findMany({
      where: { saleId },
      include: { items: true },
    });

    const map = new Map<number, number>();
    for (const ret of returns) {
      for (const item of ret.items) {
        map.set(
          item.storeProductId,
          (map.get(item.storeProductId) ?? 0) + item.quantity,
        );
      }
    }
    return map;
  }

  async searchBySerial(serial: string) {
    const serialNumber = await this.prisma.serialNumber.findUnique({
      where: { serial },
      include: {
        batch: {
          include: {
            storeProduct: {
              include: {
                product: { include: { images: { take: 1, orderBy: { sortOrder: 'asc' } } } },
                branch: true,
              },
            },
          },
        },
        saleItem: {
          include: {
            sale: { include: { customer: true } },
          },
        },
      },
    });
    if (!serialNumber) throw new NotFoundException('Serial number not found');
    return serialNumber;
  }
}
