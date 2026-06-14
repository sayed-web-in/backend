import { Injectable } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { AddToStoreDto } from './dto/add-to-store.dto.js';
import { UpdateStoreProductDto } from './dto/update-store-product.dto.js';
import {
  ProductQueryDto,
  StoreProductQueryDto,
  DraftProductQueryDto,
} from './dto/product-query.dto.js';
import { PriceListQueryDto } from './dto/price-list-query.dto.js';
import { ProductCatalogService } from './services/product-catalog.service.js';
import { ProductStoreService } from './services/product-store.service.js';
import { ProductStorefrontService } from './services/product-storefront.service.js';
import { MAX_BARCODE_LENGTH } from './helpers/product-catalog.util.js';

/** Facade — keeps controller and module imports stable. */
@Injectable()
export class ProductService {
  constructor(
    private readonly catalogSvc: ProductCatalogService,
    private readonly storeSvc: ProductStoreService,
    private readonly storefrontSvc: ProductStorefrontService,
  ) {}

  create(dto: CreateProductDto) {
    return this.catalogSvc.create(dto);
  }
  findAll(query: ProductQueryDto) {
    return this.catalogSvc.findAll(query);
  }
  findOne(id: number, forWebsite = false) {
    return this.catalogSvc.findOne(id, forWebsite);
  }
  update(id: number, dto: UpdateProductDto) {
    return this.catalogSvc.update(id, dto);
  }
  archive(id: number) {
    return this.catalogSvc.archive(id);
  }
  restore(id: number) {
    return this.catalogSvc.restore(id);
  }
  permanentDeleteArchived(id: number) {
    return this.catalogSvc.permanentDeleteArchived(id);
  }

  addToStore(dto: AddToStoreDto) {
    return this.storeSvc.addToStore(dto);
  }
  updateStoreProduct(storeProductId: number, dto: UpdateStoreProductDto) {
    return this.storeSvc.updateStoreProduct(storeProductId, dto);
  }
  deleteStoreProduct(storeProductId: number) {
    return this.storeSvc.deleteStoreProduct(storeProductId);
  }
  getBranchVariants(productId: number) {
    return this.storeSvc.getBranchVariants(productId);
  }
  getBatchById(batchId: number) {
    return this.storeSvc.getBatchById(batchId);
  }
  findBatchByBarcodeForPos(code: string, branchId: number) {
    return this.storeSvc.findBatchByBarcodeForPos(code, branchId);
  }
  getLabelBarcodeConfig() {
    return { maxLength: MAX_BARCODE_LENGTH, field: 'barcode' as const };
  }
  getStoreProducts(query: StoreProductQueryDto) {
    return this.storeSvc.getStoreProducts(query);
  }
  getPriceList(query: PriceListQueryDto) {
    return this.storeSvc.getPriceList(query);
  }
  getDraftProducts(query: DraftProductQueryDto) {
    return this.storeSvc.getDraftProducts(query);
  }
  getLowStock(query: StoreProductQueryDto) {
    return this.storeSvc.getLowStock(query);
  }
  getBatches(storeProductId: number) {
    return this.storeSvc.getBatches(storeProductId);
  }
  getAvailableSerialsForStoreProduct(storeProductId: number) {
    return this.storeSvc.getAvailableSerialsForStoreProduct(storeProductId);
  }

  findBySlug(slug: string) {
    return this.storefrontSvc.findBySlug(slug);
  }
  getSitemapProducts() {
    return this.storefrontSvc.getSitemapProducts();
  }
  search(query: string, categoryId?: number) {
    return this.storefrontSvc.search(query, categoryId);
  }
}
