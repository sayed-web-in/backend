import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateSaleDto } from '../dto/create-sale.dto.js';
import { generateSaleInvoiceNumber } from '../helpers/sale-invoice.util.js';
import { avgPurchaseUnitCostByStoreProductIds } from '../../common/avg-purchase-unit-cost.js';
import { postPosServiceIncomeIfNeeded } from '../../common/pos-service-income.js';
import {
  fifoConsumeBatchesForSaleLine,
  imeiConsumeBatchesForSaleLine,
} from '../../common/sale-line-fifo-cost.js';

@Injectable()
export class SaleCreateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSaleDto) {
    return this.prisma.$transaction(async (tx) => {
      const invoiceNumber = generateSaleInvoiceNumber();

      /** Sum lines with Decimal (avoid JS float drift vs POS `formatPrice` / whole-taka display). */
      let totalAmount = new Prisma.Decimal(0);
      for (const item of dto.items) {
        const itemDiscount = new Prisma.Decimal(item.discount ?? 0);
        const lineTotal = new Prisma.Decimal(item.unitPrice)
          .mul(item.quantity)
          .sub(itemDiscount)
          .toDecimalPlaces(2);
        totalAmount = totalAmount.add(lineTotal);
      }

      const discount = new Prisma.Decimal(dto.discount ?? 0);
      const tax = new Prisma.Decimal(dto.tax ?? 0);
      const servicesTotal = new Prisma.Decimal(dto.servicesTotal ?? 0);
      if (servicesTotal.lessThan(0)) {
        throw new BadRequestException('servicesTotal cannot be negative');
      }
      const grandTotal = totalAmount
        .sub(discount)
        .add(tax)
        .add(servicesTotal)
        .toDecimalPlaces(2);

      const status = dto.status ?? 'COMPLETED';
      let advanceDec = new Prisma.Decimal(dto.advanceApplied ?? 0);
      if (advanceDec.lessThan(0)) advanceDec = new Prisma.Decimal(0);

      if (advanceDec.greaterThan(0) && !dto.customerId) {
        throw new BadRequestException(
          'customerId is required when applying customer advance',
        );
      }

      if (dto.termsAndConditionId != null) {
        const terms = await tx.termsAndCondition.findFirst({
          where: { id: dto.termsAndConditionId, isActive: true },
        });
        if (!terms) {
          throw new BadRequestException(
            'Selected terms & conditions not found or inactive',
          );
        }
      }

      const totalCashGross =
        status === 'PAY_LATER'
          ? new Prisma.Decimal(0)
          : new Prisma.Decimal(dto.paidAmount ?? 0);

      if (advanceDec.greaterThan(0)) {
        const cust = await tx.customer.findUnique({
          where: { id: dto.customerId! },
          select: { totalAdvance: true },
        });
        if (!cust) throw new NotFoundException('Customer not found');
        const advBal = new Prisma.Decimal(cust.totalAdvance);
        if (advanceDec.sub(advBal).greaterThan(0.02)) {
          throw new BadRequestException(
            `advanceApplied cannot exceed customer advance balance (${advBal.toFixed(2)})`,
          );
        }
        if (advanceDec.sub(grandTotal).greaterThan(0.02)) {
          throw new BadRequestException(
            'advanceApplied cannot exceed sale grand total',
          );
        }
      }

      const totalPaid = advanceDec.add(totalCashGross);
      const changeAmount = totalPaid.sub(grandTotal).greaterThan(0)
        ? totalPaid.sub(grandTotal)
        : new Prisma.Decimal(0);
      const dueAmount = grandTotal.sub(totalPaid).greaterThan(0)
        ? grandTotal.sub(totalPaid)
        : new Prisma.Decimal(0);
      const paidAmount = grandTotal.sub(dueAmount);

      let effectiveStatus = status;
      if (status === 'PAY_LATER' && dueAmount.lte(0)) {
        effectiveStatus = 'COMPLETED';
      }

      let saleNote = dto.note?.trim() || null;
      if (advanceDec.greaterThan(0)) {
        const advNote = `Advance: ${advanceDec.toFixed(2)}`;
        saleNote = saleNote ? `${saleNote} | ${advNote}` : advNote;
      }

      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          customerId: dto.customerId,
          branchId: dto.branchId,
          totalAmount,
          discount,
          tax,
          grandTotal,
          servicesTotal,
          paidAmount,
          advanceApplied: advanceDec,
          changeAmount,
          dueAmount,
          paymentMethod: dto.paymentMethod,
          paymentAccountId: dto.paymentAccountId,
          status: effectiveStatus,
          note: saleNote,
          termsAndConditionId: dto.termsAndConditionId ?? null,
        },
      });

      if (advanceDec.greaterThan(0)) {
        await tx.customer.update({
          where: { id: dto.customerId! },
          data: { totalAdvance: { decrement: advanceDec } },
        });
      }

      const spIds = [...new Set(dto.items.map((i) => i.storeProductId))];
      const fbMap = await avgPurchaseUnitCostByStoreProductIds(tx, spIds);
      const spRows = await tx.storeProduct.findMany({
        where: { id: { in: spIds } },
        select: { id: true, averageCost: true },
      });
      const spAvgMap = new Map(
        spRows.map((r) => [r.id, new Prisma.Decimal(r.averageCost)]),
      );

      for (const item of dto.items) {
        const itemDiscount = new Prisma.Decimal(item.discount ?? 0);
        const itemTotal = new Prisma.Decimal(item.unitPrice)
          .mul(item.quantity)
          .sub(itemDiscount)
          .toDecimalPlaces(2);

        const fb = new Prisma.Decimal(fbMap.get(item.storeProductId) ?? 0);
        const avgSnap =
          spAvgMap.get(item.storeProductId) ?? new Prisma.Decimal(0);
        /** Seller-admin: snapshot `averageCost` (moving WAC) at sale time. */
        const snapUnit = avgSnap.greaterThan(0) ? avgSnap : fb;

        const serials = (item.serialNumbers ?? [])
          .map((s) => String(s).trim())
          .filter(Boolean);

        if (serials.length > 0 && serials.length !== item.quantity) {
          throw new BadRequestException(
            `Store product #${item.storeProductId}: expected ${item.quantity} serial(s), got ${serials.length}`,
          );
        }

        if (serials.length > 0) {
          await imeiConsumeBatchesForSaleLine(
            tx,
            serials,
            item.storeProductId,
            fb,
          );
        } else {
          await fifoConsumeBatchesForSaleLine(
            tx,
            item.storeProductId,
            item.quantity,
            fb,
          );
        }

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            storeProductId: item.storeProductId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: itemDiscount,
            total: itemTotal,
            costPrice: snapUnit.toDecimalPlaces(6),
          },
        });

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: { quantity: { decrement: item.quantity } },
        });

        if (serials.length > 0) {
          await tx.serialNumber.updateMany({
            where: { serial: { in: serials } },
            data: { status: 'SOLD', saleItemId: saleItem.id },
          });
        }
      }

      let serviceIncomeAccountId: number | null = dto.paymentAccountId ?? null;

      if (effectiveStatus === 'COMPLETED') {
        /** Net cash/bank leg credited to accounts (seller-style): overpay/change is not deposited. */
        const moneyCreditCap = paidAmount.sub(advanceDec).greaterThan(0)
          ? paidAmount.sub(advanceDec)
          : new Prisma.Decimal(0);

        const providedPayments = Array.isArray(dto.payments)
          ? dto.payments
              .map((p) => ({
                accountId: Number(p.accountId),
                amount: Number(p.amount ?? 0),
              }))
              .filter((p) => Number.isFinite(p.accountId) && p.accountId > 0 && p.amount > 0)
          : [];

        if (moneyCreditCap.greaterThan(0.009)) {
          const hasSplitPayments = providedPayments.length > 0;
          const hasLegacySingleAccount =
            dto.paymentAccountId != null &&
            Number.isFinite(Number(dto.paymentAccountId)) &&
            Number(dto.paymentAccountId) > 0 &&
            totalCashGross.greaterThan(0);

          if (!hasSplitPayments && !hasLegacySingleAccount) {
            throw new BadRequestException(
              'A payment account is required when receiving cash or bank payment on a completed sale.',
            );
          }

          const accountIdsToCheck = hasSplitPayments
            ? providedPayments.map((p) => p.accountId)
            : [Number(dto.paymentAccountId)];

          for (const accountId of accountIdsToCheck) {
            const account = await tx.account.findUnique({
              where: { id: accountId },
            });
            if (!account) {
              throw new NotFoundException(`Payment account #${accountId} not found`);
            }
            if (!account.isActive) {
              throw new BadRequestException(
                `Payment account "${account.name}" is inactive`,
              );
            }
          }
        }

        if (providedPayments.length > 0) {
          let rawSumDec = new Prisma.Decimal(0);
          for (const p of providedPayments) {
            rawSumDec = rawSumDec.add(new Prisma.Decimal(p.amount));
          }

          if (rawSumDec.greaterThan(0)) {
            const totalToCredit = rawSumDec.lessThan(moneyCreditCap)
              ? rawSumDec
              : moneyCreditCap;
            serviceIncomeAccountId = providedPayments[0]?.accountId ?? null;

            if (totalToCredit.greaterThan(0)) {
              let credited = new Prisma.Decimal(0);
              for (let i = 0; i < providedPayments.length; i++) {
                const p = providedPayments[i];
                const rowAmt = new Prisma.Decimal(p.amount);
                if (rowAmt.lte(0)) continue;

                const isLastPositive =
                  !providedPayments
                    .slice(i + 1)
                    .some((x) => new Prisma.Decimal(x.amount).greaterThan(0));

                const portion = isLastPositive
                  ? totalToCredit.sub(credited)
                  : totalToCredit.mul(rowAmt).div(rawSumDec).toDecimalPlaces(2);
                credited = credited.add(portion);
                if (portion.lte(0)) continue;

                await tx.transaction.create({
                  data: {
                    accountId: p.accountId,
                    type: 'CREDIT',
                    amount: portion,
                    reference: invoiceNumber,
                    description: `Sale payment - ${invoiceNumber}`,
                  },
                });

                await tx.account.update({
                  where: { id: p.accountId },
                  data: { balance: { increment: portion } },
                });
              }
            }
          }
        } else if (dto.paymentAccountId && totalCashGross.greaterThan(0)) {
          const creditAmt = totalCashGross.lessThan(moneyCreditCap)
            ? totalCashGross
            : moneyCreditCap;
          if (creditAmt.greaterThan(0)) {
            await tx.transaction.create({
              data: {
                accountId: dto.paymentAccountId,
                type: 'CREDIT',
                amount: creditAmt,
                reference: invoiceNumber,
                description: `Sale payment - ${invoiceNumber}`,
              },
            });

            await tx.account.update({
              where: { id: dto.paymentAccountId },
              data: { balance: { increment: creditAmt } },
            });
          }
        }

        if (servicesTotal.greaterThan(0)) {
          const cust =
            dto.customerId != null
              ? await tx.customer.findUnique({
                  where: { id: dto.customerId },
                  select: { name: true },
                })
              : null;
          await postPosServiceIncomeIfNeeded(tx, {
            servicesTotal,
            branchId: dto.branchId,
            invoiceNumber,
            customerName: cust?.name ?? null,
            paymentAccountId: serviceIncomeAccountId,
          });
        }
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
          termsAndCondition: true,
        },
      });
    });
  }
}