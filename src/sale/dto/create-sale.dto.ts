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
  @IsString()
  note?: string;

  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;
}
