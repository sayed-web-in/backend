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

  @IsString()
  paymentMethod: string;

  @IsOptional()
  @IsInt()
  paymentAccountId?: number;

  @IsNumber()
  paidAmount: number;

  @IsOptional()
  @IsString()
  note?: string;
}
