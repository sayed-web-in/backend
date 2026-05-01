import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { OrderService } from './order.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { CompleteOrderDto } from './dto/complete-order.dto.js';
import { OrderQueryDto } from './dto/order-query.dto.js';
import { PaginationDto } from '../common/pagination.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateOrderDto, @Request() req: any) {
    if (req.user?.type !== 'customer') {
      throw new ForbiddenException(
        'Only registered customers can place orders on the storefront',
      );
    }
    return this.orderService.create({
      ...dto,
      customerId: req.user.sub,
    });
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Query() query: OrderQueryDto) {
    return this.orderService.findAll(query);
  }

  @Get('track/:orderNumber')
  trackOrder(@Param('orderNumber') orderNumber: string) {
    return this.orderService.trackOrder(orderNumber);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  myOrders(@Query() query: PaginationDto, @Request() req: any) {
    if (req.user?.type !== 'customer') {
      throw new ForbiddenException('Customers only');
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    return this.orderService.findForCustomer(req.user.sub, page, limit);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.orderService.findOne(id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orderService.updateStatus(id, dto);
  }

  @Post(':id/complete')
  @UseGuards(JwtAuthGuard)
  completeOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteOrderDto,
  ) {
    return this.orderService.completeOrder(id, dto);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancelOrder(@Param('id', ParseIntPipe) id: number) {
    return this.orderService.cancelOrder(id);
  }
}
