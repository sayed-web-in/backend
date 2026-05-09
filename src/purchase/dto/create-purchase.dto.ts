import {
  IsOptional,
  IsInt,
  IsNumber,
  IsString,
  IsArray,
  ValidateNested,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PurchasePaymentRowDto {
  @IsInt()
  accountId: number;

  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class CreatePurchaseItemDto {
  @IsInt()
  storeProductId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  unitCost: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class CreatePurchaseDto {
  @IsOptional()
  @IsInt()
  supplierId?: number;

  @IsInt()
  branchId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  items: CreatePurchaseItemDto[];

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsNumber()
  tax?: number;

  @IsOptional()
  @IsNumber()
  shippingCost?: number;

  @IsString()
  paymentMethod: string;

  @IsOptional()
  @IsInt()
  paymentAccountId?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchasePaymentRowDto)
  payments?: PurchasePaymentRowDto[];

  @IsNumber()
  paidAmount: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  advanceApplied?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
