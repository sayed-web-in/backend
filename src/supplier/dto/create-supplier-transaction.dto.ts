import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

/** Seller-admin custom transaction modal: `advance` | `due` only. */
export enum SupplierCustomTransactionType {
  advance = 'advance',
  due = 'due',
}

export class CreateSupplierTransactionDto {
  @IsEnum(SupplierCustomTransactionType)
  type: SupplierCustomTransactionType;

  @IsNumber()
  @Min(0.01)
  amount: number;

  /** Required unless `type` is `due` and `offsetsOpeningInventory` is true. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  accountId?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === false || value === 'false' || value === 0 || value === '0')
      return false;
    return value === true || value === 'true' || value === 1 || value === '1';
  })
  @IsBoolean()
  offsetsOpeningInventory?: boolean;

  @IsOptional()
  @IsString()
  invoiceNo?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  purchaseId?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;
}
