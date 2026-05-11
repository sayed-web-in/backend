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

export class PurchaseReturnItemDto {
  @IsInt()
  storeProductId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  unitCost: number;

  /** good | damage | warranty — stored inside combined return reason (seller-admin parity). */
  @IsOptional()
  @IsString()
  @IsIn(['good', 'damage', 'warranty'])
  returnType?: string;

  /** IMEI/serial strings must match quantity when provided (seller-style). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class CreatePurchaseReturnDto {
  @IsInt()
  purchaseId: number;

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
  @Type(() => PurchaseReturnItemDto)
  items: PurchaseReturnItemDto[];
}
