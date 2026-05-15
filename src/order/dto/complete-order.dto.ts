import {
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Per line: pick IMEI/serial strings that will be sold when completing the order. */
export class CompleteOrderImeiLineDto {
  @IsInt()
  orderItemId: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  serialNumbers: string[];
}

export class CompleteOrderDto {
  @IsInt()
  branchId: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  /** Required — order sell-out must credit a cash/bank/mobile account (same as POS). */
  @IsInt()
  paymentAccountId: number;

  /** Required for order lines whose product has IMEI tracking. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteOrderImeiLineDto)
  imeiLines?: CompleteOrderImeiLineDto[];
}
