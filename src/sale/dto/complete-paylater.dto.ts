import { IsNumber, IsString, IsOptional, IsInt } from 'class-validator';

export class CompletePaylaterDto {
  @IsNumber()
  paidAmount: number;

  @IsString()
  paymentMethod: string;

  @IsOptional()
  @IsInt()
  paymentAccountId?: number;
}
