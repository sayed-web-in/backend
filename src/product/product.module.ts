import { Module } from '@nestjs/common';
import { ProductService } from './product.service.js';
import { ProductController } from './product.controller.js';
import { ProductCatalogService } from './services/product-catalog.service.js';
import { ProductStoreService } from './services/product-store.service.js';
import { ProductStorefrontService } from './services/product-storefront.service.js';

@Module({
  controllers: [ProductController],
  providers: [
    ProductCatalogService,
    ProductStoreService,
    ProductStorefrontService,
    ProductService,
  ],
  exports: [
    ProductService,
    ProductCatalogService,
    ProductStoreService,
    ProductStorefrontService,
  ],
})
export class ProductModule {}
