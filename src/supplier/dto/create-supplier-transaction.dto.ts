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
