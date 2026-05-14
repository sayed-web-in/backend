import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import {
  CompleteOrderDto,
  CompleteOrderImeiLineDto,
} from './dto/complete-order.dto.js';
import { OrderQueryDto } from './dto/order-query.dto.js';
import { paginate } from '../common/pagination.dto.js';
import { Prisma, OrderStatus } from '@prisma/client';
import { bdDayEndUtc, bdDayStartUtc } from '../common/bd-time.js';
import { avgPurchaseUnitCostByStoreProductIds } from '../common/avg-purchase-unit-cost.js';
import { fifoConsumeBatchesForSaleLine } from '../common/sale-line-fifo-cost.js';

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService) {}

  private generateOrderNumber(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${ts}-${rand}`;
  }

  private generateInvoiceNumber(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV-${ts}-${rand}`;
  }

  async create(dto: CreateOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const orderNumber = this.generateOrderNumber();

      let customerId = dto.customerId;
      if (customerId != null) {
        const c = await tx.customer.findUnique({ where: { id: customerId } });
        if (!c) throw new NotFoundException('Customer not found');
        await tx.customer.update({
          where: { id: customerId },
          data: {
            name: dto.name,
            phone: String(dto.phone ?? '').trim(),
            address: dto.address ?? c.address,
            division: dto.division ?? c.division,
            district: dto.district ?? c.district,
          },
        });
      } else {
        const phone = String(dto.phone ?? '').trim();
        if (!phone) throw new BadRequestException('Phone is required');
        const existing = await tx.customer.findFirst({ where: { phone } });
        if (existing) {
          await tx.customer.update({
            where: { id: existing.id },
            data: {
              name: dto.name,
              address: dto.address ?? existing.address,
              division: dto.division ?? existing.division,
              district: dto.district ?? existing.district,
            },
          });
          customerId = existing.id;
        } else {
          const created = await tx.customer.create({
            data: {
              name: dto.name,
              phone,
              address: dto.address,
              division: dto.division,
              district: dto.district,
            },
          });
          customerId = created.id;
        }
      }

      let totalAmount = new Prisma.Decimal(0);
      const itemsData: {
        storeProductId: number;
        quantity: number;
        unitPrice: Prisma.Decimal;
        total: Prisma.Decimal;
      }[] = [];

      for (const item of dto.items) {
        const rawUnit = item.unitPrice ?? item.price;
        if (rawUnit == null || Number.isNaN(Number(rawUnit))) {
          throw new BadRequestException(
            'Each order line must include unitPrice or price',
          );
        }
        const unitPrice = new Prisma.Decimal(rawUnit);
        const total = unitPrice.mul(item.quantity);
        totalAmount = totalAmount.add(total);
        itemsData.push({
          storeProductId: item.storeProductId,
          quantity: item.quantity,
          unitPrice,
          total,
        });
      }

      const order = await tx.order.create({
        data: {
          orderNumber,
          customerId: customerId!,
          name: dto.name,
          phone: dto.phone,
          division: dto.division,
          district: dto.district,
          address: dto.address,
          totalAmount,
          paymentMethod: dto.paymentMethod,
          status: OrderStatus.PENDING,
          items: { create: itemsData },
          tracking: {
            create: {
              status: OrderStatus.PENDING,
              note: 'Order placed',
            },
          },
        },
        include: {
          items: {
            include: {
              storeProduct: {
                include: { product: { include: { images: { take: 1 } } } },
              },
            },
          },
          tracking: true,
          customer: true,
        },
      });

      return order;
    });
  }

  async findAll(query: OrderQueryDto) {
    const {
      page = 1,
      limit = 16,
      search,
      status,
      dateFrom,
      dateTo,
      sort,
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { phone: { contains: search } },
        { name: { contains: search } },
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
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          customer: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findForCustomer(
    customerId: number,
    page: number = 1,
    limit: number = 10,
  ) {
    const safeLimit = Math.min(Math.max(1, limit), 50);
    const safePage = Math.max(1, page);
    const skip = (safePage - 1) * safeLimit;
    const where: Prisma.OrderWhereInput = { customerId };

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
        include: {
          items: { select: { id: true, quantity: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(data, total, safePage, safeLimit);
  }

  async findOne(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        items: {
          include: {
            storeProduct: {
              include: {
                branch: true,
                product: {
                  include: {
                    images: { take: 1, orderBy: { sortOrder: 'asc' } },
                  },
                },
                productVariant: {
                  include: {
                    attributes: { include: { attributeValue: true } },
                  },
                },
              },
            },
          },
        },
        tracking: { orderBy: { createdAt: 'asc' } },
        sale: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async updateStatus(id: number, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot update a cancelled order');
    }
    if (order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException('Cannot update a delivered order');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.orderTracking.create({
        data: {
          orderId: id,
          status: dto.status,
          note: dto.note,
        },
      });

      return tx.order.update({
        where: { id },
        data: { status: dto.status },
        include: {
          customer: true,
          tracking: { orderBy: { createdAt: 'asc' } },
        },
      });
    });
  }

  async completeOrder(id: number, dto: CompleteOrderDto) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            storeProduct: {
              include: {
                product: { select: { hasImei: true } },
              },
            },
          },
        },
        sale: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const activeItems = order.items.filter((i) => !i.cancelled);
    if (activeItems.length === 0) {
      throw new BadRequestException(
        'This order has no active lines to fulfil (all lines are cancelled)',
      );
    }

    for (const item of activeItems) {
      if (item.storeProduct.branchId !== dto.branchId) {
        throw new BadRequestException(
          'All items must belong to the branch you select for fulfillment',
        );
      }
    }

    if (order.sale) {
      throw new BadRequestException('Order already converted to a sale');
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot complete a cancelled order');
    }

    const imeiByOrderItemId = new Map<number, CompleteOrderImeiLineDto>();
    for (const line of dto.imeiLines ?? []) {
      imeiByOrderItemId.set(line.orderItemId, line);
    }

    for (const item of activeItems) {
      const hasImei = item.storeProduct.product.hasImei;
      const line = imeiByOrderItemId.get(item.id);
      if (hasImei) {
        if (!line) {
          throw new BadRequestException(
            `Order line ${item.id}: IMEI product requires serialNumbers in imeiLines`,
          );
        }
        const serials = [
          ...new Set(
            line.serialNumbers.map((s) => String(s).trim()).filter(Boolean),
          ),
        ];
        if (serials.length !== item.quantity) {
          throw new BadRequestException(
            `Order line ${item.id}: need exactly ${item.quantity} unique IMEI/serial value(s), got ${serials.length}`,
          );
        }
      } else if (line?.serialNumbers?.length) {
        throw new BadRequestException(
          `Order line ${item.id}: serials were sent but product is not IMEI-tracked`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const invoiceNumber = this.generateInvoiceNumber();
      const paymentMethod = dto.paymentMethod ?? order.paymentMethod;
      const grandTotal = activeItems.reduce(
        (acc, i) => acc.add(i.total),
        new Prisma.Decimal(0),
      );

      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          customerId: order.customerId,
          branchId: dto.branchId,
          totalAmount: grandTotal,
          discount: 0,
          tax: 0,
          grandTotal,
          paidAmount: grandTotal,
          changeAmount: 0,
          dueAmount: 0,
          paymentMethod,
          paymentAccountId: dto.paymentAccountId,
          status: 'COMPLETED',
          orderId: order.id,
          note: `From order ${order.orderNumber}`,
        },
      });

      const spIds = [...new Set(activeItems.map((i) => i.storeProductId))];
      const fbMap = await avgPurchaseUnitCostByStoreProductIds(tx, spIds);
      const spRows = await tx.storeProduct.findMany({
        where: { id: { in: spIds } },
        select: { id: true, averageCost: true },
      });
      const spAvgMap = new Map(
        spRows.map((r) => [r.id, new Prisma.Decimal(r.averageCost)]),
      );

      for (const item of activeItems) {
        const itemTotal = item.unitPrice.mul(item.quantity);
        const hasImei = item.storeProduct.product.hasImei;
        const line = imeiByOrderItemId.get(item.id);
        const fb = new Prisma.Decimal(fbMap.get(item.storeProductId) ?? 0);
        const avgSnap =
          spAvgMap.get(item.storeProductId) ?? new Prisma.Decimal(0);
        /** Match seller-admin: line COGS from branch listing WAC, not per-batch FIFO $. */
        const snapUnit = avgSnap.greaterThan(0) ? avgSnap : fb;

        let imeiRows: Array<{ batchId: number }> | null = null;
        let imeiSerials: string[] = [];

        if (hasImei && line) {
          imeiSerials = [
            ...new Set(
              line.serialNumbers.map((s) => String(s).trim()).filter(Boolean),
            ),
          ];
          const rows = await tx.serialNumber.findMany({
            where: { serial: { in: imeiSerials } },
            include: { batch: true },
          });
          if (rows.length !== imeiSerials.length) {
            throw new BadRequestException(
              'One or more IMEI/serial numbers were not found',
            );
          }
          const seen = new Set<string>();
          for (const row of rows) {
            if (row.status !== 'IN_STOCK') {
              throw new BadRequestException(
                `IMEI/serial ${row.serial} is not available (status: ${row.status})`,
              );
            }
            if (row.batch.storeProductId !== item.storeProductId) {
              throw new BadRequestException(
                `IMEI/serial ${row.serial} does not belong to this store listing`,
              );
            }
            if (seen.has(row.serial)) {
              throw new BadRequestException(`Duplicate serial: ${row.serial}`);
            }
            seen.add(row.serial);
          }
          imeiRows = rows.map((r) => ({ batchId: r.batchId }));
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
            discount: 0,
            total: itemTotal,
            costPrice: snapUnit.toDecimalPlaces(6),
          },
        });

        await tx.storeProduct.update({
          where: { id: item.storeProductId },
          data: { quantity: { decrement: item.quantity } },
        });

        if (imeiRows) {
          for (const row of imeiRows) {
            await tx.batch.update({
              where: { id: row.batchId },
              data: {
                availableQty: { decrement: 1 },
                soldQty: { increment: 1 },
              },
            });
          }

          await tx.serialNumber.updateMany({
            where: { serial: { in: imeiSerials } },
            data: { status: 'SOLD', saleItemId: saleItem.id },
          });
        }
      }

      if (dto.paymentAccountId) {
        await tx.transaction.create({
          data: {
            accountId: dto.paymentAccountId,
            type: 'CREDIT',
            amount: grandTotal,
            reference: invoiceNumber,
            description: `Order completion - ${order.orderNumber}`,
          },
        });

        await tx.account.update({
          where: { id: dto.paymentAccountId },
          data: { balance: { increment: grandTotal } },
        });
      }

      await tx.orderTracking.create({
        data: {
          orderId: id,
          status: OrderStatus.DELIVERED,
          note: 'Order completed and converted to sale',
        },
      });

      return tx.order.update({
        where: { id },
        data: { status: OrderStatus.DELIVERED },
        include: {
          customer: true,
          items: true,
          tracking: { orderBy: { createdAt: 'asc' } },
          sale: { include: { items: true } },
        },
      });
    });
  }

  async trackOrder(orderNumber: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        items: {
          include: {
            storeProduct: {
              include: {
                product: {
                  include: {
                    images: { take: 1, orderBy: { sortOrder: 'asc' } },
                  },
                },
                productVariant: {
                  include: {
                    attributes: { include: { attributeValue: true } },
                  },
                },
              },
            },
          },
        },
        tracking: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async cancelOrder(id: number) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException('Cannot cancel a delivered order');
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already cancelled');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { orderId: id },
        data: { cancelled: true },
      });

      await tx.orderTracking.create({
        data: {
          orderId: id,
          status: OrderStatus.CANCELLED,
          note: 'Order cancelled',
        },
      });

      return tx.order.update({
        where: { id },
        data: { status: OrderStatus.CANCELLED },
        include: {
          customer: true,
          tracking: { orderBy: { createdAt: 'asc' } },
        },
      });
    });
  }

  async cancelOrderItem(orderId: number, itemId: number) {
    const line = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      include: {
        order: { include: { sale: true } },
      },
    });
    if (!line) {
      throw new NotFoundException('Order line not found');
    }

    const { order } = line;
    if (order.sale) {
      throw new BadRequestException(
        'Cannot cancel order lines after the order is converted to a sale',
      );
    }
    if (order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException('Cannot cancel lines on a delivered order');
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already fully cancelled');
    }
    if (line.cancelled) {
      throw new BadRequestException('This line is already cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: itemId },
        data: { cancelled: true },
      });

      const remaining = await tx.orderItem.findMany({
        where: { orderId, cancelled: false },
      });
      const newTotal = remaining.reduce(
        (acc, row) => acc.add(row.total),
        new Prisma.Decimal(0),
      );

      if (remaining.length === 0) {
        await tx.orderTracking.create({
          data: {
            orderId,
            status: OrderStatus.CANCELLED,
            note: 'All items cancelled',
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.CANCELLED,
            totalAmount: newTotal,
          },
        });
        return;
      }

      await tx.order.update({
        where: { id: orderId },
        data: { totalAmount: newTotal },
      });
    });

    return this.findOne(orderId);
  }
}
