import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  Min,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SaleReturnItemDto {
  /** Preferred: links return line to invoice row (seller-admin parity). */
  @IsOptional()
  @IsInt()
  saleItemId?: number;

  @IsInt()
  storeProductId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  unitPrice: number;

  @IsOptional()
  @IsString()
  returnType?: string;

  @IsOptional()
  @IsString()
  returnReason?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];

  @IsOptional()
  @IsIn(['none', 'percentage', 'fixed'])
  damageDeductionType?: 'none' | 'percentage' | 'fixed';

  @IsOptional()
  @IsNumber()
  damageDeductionValue?: number;
}

export class CreateSaleReturnDto {
  @IsInt()
  saleId: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  returnDate?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  responsiblePerson?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleReturnItemDto)
  items: SaleReturnItemDto[];
}
