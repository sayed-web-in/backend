import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { CompleteOrderDto } from './dto/complete-order.dto.js';
import { OrderQueryDto } from './dto/order-query.dto.js';
import { paginate } from '../common/pagination.dto.js';
import { Prisma, OrderStatus } from '@prisma/client';

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

      let totalAmount = new Prisma.Decimal(0);
      const itemsData: {
        storeProductId: number;
        quantity: number;
        unitPrice: Prisma.Decimal;
        total: Prisma.Decimal;
      }[] = [];

      for (const item of dto.items) {
        const unitPrice = new Prisma.Decimal(item.unitPrice);
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
          customerId: dto.customerId,
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
      where.orderNumber = { contains: search };
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

  async findOne(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
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
      include: { items: true, sale: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.sale) {
      throw new BadRequestException('Order already converted to a sale');
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot complete a cancelled order');
    }

    return this.prisma.$transaction(async (tx) => {
      const invoiceNumber = this.generateInvoiceNumber();
      const paymentMethod = dto.paymentMethod ?? order.paymentMethod;
      const grandTotal = order.totalAmount;

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

      for (const item of order.items) {
        const itemTotal = item.unitPrice.mul(item.quantity);

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            storeProductId: item.storeProductId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: 0,
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
}
