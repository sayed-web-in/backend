import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreatePurchaseDto } from '../dto/create-purchase.dto.js';
import { weightedAverageCostAfterPurchase } from '../../common/store-product-wac.js';
import {
  generatePurchaseReferenceNo,
  generatePurchaseBatchNumber,
} from '../helpers/purchase-query.filters.js';

@Injectable()
export class PurchaseCreateService {
  constructor(private readonly prisma: PrismaService) {}
  async create(dto: CreatePurchaseDto) {
    return this.prisma.$transaction(async (tx) => {
      const referenceNo = generatePurchaseReferenceNo();

      let totalAmount = new Prisma.Decimal(0);
      for (const item of dto.items) {
        totalAmount = totalAmount.add(
          new Prisma.Decimal(item.unitCost).mul(
            new Prisma.Decimal(item.quantity),
          ),
        );
      }

      const discount = new Prisma.Decimal(dto.discount ?? 0);
      const tax = new Prisma.Decimal(dto.tax ?? 0);
      const shipping = new Prisma.Decimal(dto.shippingCost ?? 0);
      const grandTotal = totalAmount.sub(discount).add(tax).add(shipping);

      const paymentRows = (dto.payments ?? []).filter(
        (p) =>
          p.accountId != null &&
          new Prisma.Decimal(p.amount).greaterThan(0),
      );

      let cashPaid: Prisma.Decimal;
      let paymentAccountIdForPurchase: number | null | undefined;

      if (paymentRows.length > 0) {
        cashPaid = paymentRows.reduce(
          (acc, p) => acc.add(new Prisma.Decimal(p.amount)),
          new Prisma.Decimal(0),
        );
        paymentAccountIdForPurchase = paymentRows[0].accountId;
        const sentPaid = new Prisma.Decimal(dto.paidAmount);
        if (cashPaid.sub(sentPaid).abs().greaterThan(0.02)) {
          throw new BadRequestException(
            'paidAmount must match the sum of payment rows',
          );
        }
      } else {
        cashPaid = new Prisma.Decimal(dto.paidAmount);
        paymentAccountIdForPurchase = dto.paymentAccountId;
      }

      let advanceAppliedDec = new Prisma.Decimal(dto.advanceApplied ?? 0);
      if (advanceAppliedDec.lessThan(0)) {
        throw new BadRequestException('advanceApplied cannot be negative');
      }

      if (advanceAppliedDec.greaterThan(0)) {
        if (!dto.supplierId) {
          throw new BadRequestException(
            'supplierId is required when applying supplier advance',
          );
        }
        const supplier = await tx.supplier.findUnique({
          where: { id: dto.supplierId },
        });
        if (!supplier) {
          throw new NotFoundException('Supplier not found');
        }
        const advBal = new Prisma.Decimal(supplier.advanceBalance);
        const maxFromBill = grandTotal.sub(cashPaid);
        const maxApply = Prisma.Decimal.min(
          advBal,
          maxFromBill.greaterThan(0) ? maxFromBill : new Prisma.Decimal(0),
        );
        if (advanceAppliedDec.sub(maxApply).greaterThan(0.02)) {
          throw new BadRequestException(
            `advanceApplied cannot exceed ${maxApply.toFixed(2)} (supplier advance or remaining on this bill)`,
          );
        }
        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { advanceBalance: { decrement: advanceAppliedDec } },
        });
      } else {
        advanceAppliedDec = new Prisma.Decimal(0);
      }

      const totalPaidAmount = cashPaid.add(advanceAppliedDec);
      const dueAmount = grandTotal.sub(totalPaidAmount).greaterThan(0)
        ? grandTotal.sub(totalPaidAmount)
        : new Prisma.Decimal(0);

      const status = dueAmount.greaterThan(0) ? 'PARTIAL' : 'RECEIVED';

      let paymentMethodStored = dto.paymentMethod;
      if (!cashPaid.greaterThan(0) && advanceAppliedDec.greaterThan(0)) {
        paymentMethodStored = 'advance';
      }

      const purchase = await tx.purchase.create({
        data: {
          referenceNo,
          supplierId: dto.supplierId,
          branchId: dto.branchId,
          totalAmount,
          discount,
          tax,
          shippingCost: shipping,
          grandTotal,
          paidAmount: totalPaidAmount,
          dueAmount,
          advanceApplied: advanceAppliedDec,
          paymentMethod: paymentMethodStored,
          paymentAccountId: paymentAccountIdForPurchase ?? null,
          status,
          note: dto.note,
        },
      });

      for (const item of dto.items) {
        const itemTotal = new Prisma.Decimal(item.unitCost).mul(
          new Prisma.Decimal(item.quantity),
        );

        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            storeProductId: item.storeProductId,
            quantity: item.quantity,
            unitCost: item.unitCost,
            total: itemTotal,
          },
        });

        const storeProduct = await tx.storeProduct.findUnique({
          where: { id: item.storeProductId },
        });
        if (!storeProduct) {
          throw new NotFoundException(
            `StoreProduct #${item.storeProductId} not found`,
          );
        }

        const prevQty = storeProduct.quantity;
        const prevAvg = new Prisma.Decimal(storeProduct.averageCost);
        const addQty = item.quantity;
        const addUnit = new Prisma.Decimal(item.unitCost);
        const newAvg = weightedAverageCostAfterPurchase(
          prevQty,
          prevAvg,
          addQty,
          addUnit,
        );

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: {
            quantity: { increment: item.quantity },
            averageCost: newAvg.toDecimalPlaces(6),
          },
        });

        const batch = await tx.batch.create({
          data: {
            batchNumber: generatePurchaseBatchNumber(),
            batchType: 'purchase',
            initialQty: item.quantity,
            availableQty: item.quantity,
            purchaseCost: item.unitCost,
            totalCost: itemTotal,
            supplierId: dto.supplierId,
            storeProductId: item.storeProductId,
          },
        });

        if (item.serialNumbers?.length) {
          await tx.serialNumber.createMany({
            data: item.serialNumbers.map((serial) => ({
              serial,
              status: 'IN_STOCK' as const,
              batchId: batch.id,
            })),
          });
        }

      }

      if (paymentRows.length > 0) {
        for (const p of paymentRows) {
          const amt = new Prisma.Decimal(p.amount);
          const account = await tx.account.findUnique({
            where: { id: p.accountId },
          });
          if (!account) {
            throw new NotFoundException(`Account #${p.accountId} not found`);
          }
          if (new Prisma.Decimal(account.balance).lessThan(amt)) {
            throw new BadRequestException(
              `Insufficient balance on account "${account.name}"`,
            );
          }
          await tx.transaction.create({
            data: {
              accountId: p.accountId,
              type: 'DEBIT',
              amount: amt,
              reference: referenceNo,
              description: `Purchase payment - ${referenceNo}`,
            },
          });
          await tx.account.update({
            where: { id: p.accountId },
            data: { balance: { decrement: amt } },
          });
        }
      } else if (dto.paymentAccountId && cashPaid.greaterThan(0)) {
        const account = await tx.account.findUnique({
          where: { id: dto.paymentAccountId },
        });
        if (!account) {
          throw new NotFoundException(
            `Account #${dto.paymentAccountId} not found`,
          );
        }
        if (new Prisma.Decimal(account.balance).lessThan(cashPaid)) {
          throw new BadRequestException(
            `Insufficient balance on account "${account.name}"`,
          );
        }
        await tx.transaction.create({
          data: {
            accountId: dto.paymentAccountId,
            type: 'DEBIT',
            amount: cashPaid,
            reference: referenceNo,
            description: `Purchase payment - ${referenceNo}`,
          },
        });

        await tx.account.update({
          where: { id: dto.paymentAccountId },
          data: { balance: { decrement: cashPaid } },
        });
      }

      if (dto.supplierId && dueAmount.greaterThan(0)) {
        await tx.supplier.update({
          where: { id: dto.supplierId },
          data: { totalDue: { increment: dueAmount } },
        });
      }

      return tx.purchase.findUnique({
        where: { id: purchase.id },
        include: {
          items: {
            include: {
              storeProduct: {
                include: { product: true, productVariant: true },
              },
            },
          },
          supplier: true,
          branch: true,
          paymentAccount: true,
        },
      });
    });
  }

}
