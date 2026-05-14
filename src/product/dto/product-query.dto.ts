import {
  IsOptional,
  IsInt,
  IsEnum,
  IsBoolean,
  IsNumber,
  IsIn,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ProductStatus, SellingType } from '@prisma/client';
import { PaginationDto } from '../../common/pagination.dto.js';

export class ProductQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subCategoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  brandId?: number;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isBestDeal?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priceMax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branchId?: number;

  @IsOptional()
  @IsEnum(SellingType)
  sellingType?: SellingType;

  /** When true, list archived products only (recycle bin / archive page). */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isArchived?: boolean;

  /**
   * Website catalog: only products that have at least one active store SKU with
   * sellingType ONLINE or BOTH, and nested storeProducts are filtered the same.
   * Omit for POS / internal (shows STORE-only listings too).
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  forWebsite?: boolean;
}

export class StoreProductQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branchId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  brandId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  /** Low-stock only: critical (qty 0) or warning (qty above 0 but at or below alert). */
  @IsOptional()
  @IsIn(['critical', 'warning'])
  level?: 'critical' | 'warning';
}

/** Draft / catalog product list (not store SKUs). */
export class DraftProductQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  brandId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
