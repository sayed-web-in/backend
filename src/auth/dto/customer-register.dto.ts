import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class CustomerRegisterDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\d{11}$/, { message: 'Phone must be exactly 11 digits' })
  phone: string;

  @IsString()
  @MinLength(6)
  password: string;
}
