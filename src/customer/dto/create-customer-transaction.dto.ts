import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export enum CustomerTransactionTypeInput {
  payment = 'payment',
  advance = 'advance',
  due = 'due',
}

export class CreateCustomerTransactionDto {
  @IsEnum(CustomerTransactionTypeInput)
  type: CustomerTransactionTypeInput;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsInt()
  @Min(1)
  accountId: number;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  @IsOptional()
  @IsString()
  note?: string;

  /** When type is payment: settle this sale’s due. Omit to settle customer manual due only. */
  @IsOptional()
  @IsInt()
  @Min(1)
  saleId?: number;
}
