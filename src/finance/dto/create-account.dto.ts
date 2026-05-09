import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AccountType } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsEnum(AccountType)
  type: AccountType;

  /** Seller-style opening balance; on create, current balance starts equal to this. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  openingBalance?: number;

  /** @deprecated Prefer openingBalance; if set without openingBalance, used as opening on create. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  balance?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
