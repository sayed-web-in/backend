import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiscountType, SellingType } from '@prisma/client';

export class UpdateStoreProductDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sellingPrice?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsEnum(DiscountType)
  discountType?: DiscountType | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  discountValue?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
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

  /**
   * Applied only when this store product has exactly one batch and that batch has soldQty === 0.
   * Updates batch purchaseCost and totalCost (totalCost = purchaseCost * initialQty).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  purchaseCostPerUnit?: number;
}
