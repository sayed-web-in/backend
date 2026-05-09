import {
  IsOptional,
  IsInt,
  IsNumber,
  IsString,
  IsArray,
  IsEnum,
  ValidateNested,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SaleStatus } from '@prisma/client';

export class CreateSaleItemDto {
  @IsInt()
  storeProductId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class CreateSalePaymentDto {
  @IsInt()
  accountId: number;

  @IsNumber()
  @Min(0)
  amount: number;
}

export class CreateSaleDto {
  @IsOptional()
  @IsInt()
  customerId?: number;

  @IsInt()
  branchId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items: CreateSaleItemDto[];

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsNumber()
  tax?: number;

  @IsString()
  paymentMethod: string;

  @IsOptional()
  @IsInt()
  paymentAccountId?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalePaymentDto)
  payments?: CreateSalePaymentDto[];

  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  @IsOptional()
  @IsNumber()
  changeAmount?: number;

  @IsOptional()
  @IsNumber()
  dueAmount?: number;

  /** Customer advance/wallet applied to this sale (cash stays in `paidAmount` / `payments` only). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  advanceApplied?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;

  /** POS service add-ons (same as admin POS `appliedServices` total). Added to grandTotal. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  servicesTotal?: number;
}
