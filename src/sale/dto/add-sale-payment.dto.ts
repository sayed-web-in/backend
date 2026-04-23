import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AddSalePaymentDto {
  @IsInt()
  accountId: number;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}

