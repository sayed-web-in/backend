import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompletePaylaterDto } from '../dto/complete-paylater.dto.js';
import { AddSalePaymentDto } from '../dto/add-sale-payment.dto.js';
import { postPosServiceIncomeIfNeeded } from '../../common/pos-service-income.js';

@Injectable()
export class SalePaymentService {
  constructor(private readonly prisma: PrismaService) {}
  async completePayLater(saleId: number, dto: CompletePaylaterDto) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.status !== 'PAY_LATER') {
      throw new BadRequestException('Sale is not in PAY_LATER status');
    }

    return this.prisma.$transaction(async (tx) => {
      const grossPaid = new Prisma.Decimal(dto.paidAmount);
      const changeAmount = grossPaid.sub(sale.grandTotal).greaterThan(0)
        ? grossPaid.sub(sale.grandTotal)
        : new Prisma.Decimal(0);
      const paidAmount = grossPaid.sub(changeAmount);
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
        const netReceived = paidAmount;
        await tx.transaction.create({
          data: {
            accountId: dto.paymentAccountId,
            type: 'CREDIT',
            amount: netReceived,
            reference: sale.invoiceNumber,
            description: `Pay-later completion - ${sale.invoiceNumber}`,
          },
        });

        await tx.account.update({
          where: { id: dto.paymentAccountId },
          data: { balance: { increment: netReceived } },
        });
      }

      const svcTotal = new Prisma.Decimal(sale.servicesTotal ?? 0);
      if (svcTotal.greaterThan(0)) {
        const cust =
          sale.customerId != null
            ? await tx.customer.findUnique({
                where: { id: sale.customerId },
                select: { name: true },
              })
            : null;
        await postPosServiceIncomeIfNeeded(tx, {
          servicesTotal: svcTotal,
          branchId: sale.branchId,
          invoiceNumber: sale.invoiceNumber,
          customerName: cust?.name ?? null,
          paymentAccountId: dto.paymentAccountId ?? null,
        });
      }

      return updated;
    });
  }

  async listPayments(saleId: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      select: { invoiceNumber: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    return this.prisma.transaction.findMany({
      where: { reference: sale.invoiceNumber, type: 'CREDIT' },
      orderBy: { createdAt: 'desc' },
      include: { account: true },
    });
  }

  async addDuePayment(saleId: number, dto: AddSalePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId } });
      if (!sale) throw new NotFoundException('Sale not found');
      if (sale.status === 'RETURNED') {
        throw new BadRequestException('Cannot pay a returned sale');
      }
      if (sale.dueAmount.lte(0)) {
        throw new BadRequestException('No due amount remaining for this sale');
      }

      const dueBefore = sale.dueAmount;
      const requested = new Prisma.Decimal(dto.amount);
      if (requested.gt(dueBefore)) {
        throw new BadRequestException('Amount cannot exceed due amount');
      }

      const account = await tx.account.findUnique({ where: { id: dto.accountId } });
      if (!account) throw new NotFoundException('Account not found');

      const paidAmount = sale.paidAmount.add(requested);
      const dueAmount = sale.grandTotal.sub(paidAmount).greaterThan(0)
        ? sale.grandTotal.sub(paidAmount)
        : new Prisma.Decimal(0);

      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          paidAmount,
          dueAmount,
          changeAmount: new Prisma.Decimal(0),
          paymentAccountId: sale.paymentAccountId ?? dto.accountId,
          status: dueAmount.greaterThan(0) ? sale.status : 'COMPLETED',
        },
      });

      const txn = await tx.transaction.create({
        data: {
          accountId: dto.accountId,
          type: 'CREDIT',
          amount: requested,
          reference: sale.invoiceNumber,
          description: dto.note?.trim()
            ? `Sale due payment - ${sale.invoiceNumber} (${dto.note.trim()})`
            : `Sale due payment - ${sale.invoiceNumber}`,
        },
        include: { account: true },
      });

      await tx.account.update({
        where: { id: dto.accountId },
        data: { balance: { increment: requested } },
      });

      return { sale: updatedSale, payment: txn };
    });
  }
}