import { IsInt, IsOptional, IsString } from 'class-validator';

export class CompleteOrderDto {
  @IsInt()
  branchId: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsInt()
  paymentAccountId?: number;
}
