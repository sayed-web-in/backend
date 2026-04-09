import {
  IsInt,
  IsOptional,
  IsNumber,
  IsEnum,
  IsBoolean,
  IsArray,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiscountType, SellingType } from '@prisma/client';

export class AddToStoreDto {
  @Type(() => Number)
  @IsInt()
  productId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productVariantId?: number;

  @Type(() => Number)
  @IsInt()
  branchId: number;

  @Type(() => Number)
  @IsInt()
  quantity: number;

  @Type(() => Number)
  @IsNumber()
  purchaseCost: number;

  @Type(() => Number)
  @IsNumber()
  sellingPrice: number;

  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discountValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  quantityAlert?: number;

  @IsOptional()
  @IsEnum(SellingType)
  sellingType?: SellingType;

  @IsOptional()
  @IsBoolean()
  isBestDeal?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  supplierId?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}
