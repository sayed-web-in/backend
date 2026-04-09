import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BranchModule } from './branch/branch.module.js';
import { UploadModule } from './upload/upload.module.js';
import { CategoryModule } from './category/category.module.js';
import { BrandModule } from './brand/brand.module.js';
import { UnitModule } from './unit/unit.module.js';
import { AttributeModule } from './attribute/attribute.module.js';
import { ProductModule } from './product/product.module.js';
import { BannerModule } from './banner/banner.module.js';
import { ArticleModule } from './article/article.module.js';
import { SaleModule } from './sale/sale.module.js';
import { ServiceModule } from './service/service.module.js';
import { PurchaseModule } from './purchase/purchase.module.js';
import { StockModule } from './stock/stock.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { SupplierModule } from './supplier/supplier.module.js';
import { OrderModule } from './order/order.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { ReportModule } from './report/report.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    BranchModule,
    UploadModule,
    CategoryModule,
    BrandModule,
    UnitModule,
    AttributeModule,
    ProductModule,
    BannerModule,
    ArticleModule,
    SaleModule,
    ServiceModule,
    PurchaseModule,
    StockModule,
    CustomerModule,
    SupplierModule,
    OrderModule,
    FinanceModule,
    ReportModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
