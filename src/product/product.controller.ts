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
} from '@nestjs/common';
import { ProductService } from './product.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { AddToStoreDto } from './dto/add-to-store.dto.js';
import { ProductQueryDto, StoreProductQueryDto } from './dto/product-query.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PaginationDto } from '../common/pagination.dto.js';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('add-to-store')
  addToStore(@Body() dto: AddToStoreDto) {
    return this.productService.addToStore(dto);
  }

  @Get()
  findAll(@Query() query: ProductQueryDto) {
    return this.productService.findAll(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('store')
  getStoreProducts(@Query() query: StoreProductQueryDto) {
    return this.productService.getStoreProducts(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('draft')
  getDraftProducts(@Query() query: PaginationDto) {
    return this.productService.getDraftProducts(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('low-stock')
  getLowStock(@Query() query: StoreProductQueryDto) {
    return this.productService.getLowStock(query);
  }

  @Get('sitemap')
  getSitemapProducts() {
    return this.productService.getSitemapProducts();
  }

  @Get('search')
  search(@Query('q') q: string, @Query('categoryId') categoryId?: string) {
    return this.productService.search(q, categoryId ? Number(categoryId) : undefined);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productService.findOne(id);
  }

  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.productService.findBySlug(slug);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.productService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/archive')
  archive(@Param('id', ParseIntPipe) id: number) {
    return this.productService.archive(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.productService.restore(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('store/:id/batches')
  getBatches(@Param('id', ParseIntPipe) id: number) {
    return this.productService.getBatches(id);
  }
}
