import { IsEmail, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'])
  role?: any;

  @IsOptional()
  @IsInt()
  branchId?: number;
}
