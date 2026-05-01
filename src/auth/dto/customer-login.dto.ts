import { IsString, MaxLength, MinLength } from 'class-validator';

/** Email or 11-digit phone; resolved in AuthService. */
export class CustomerLoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  identifier: string;

  @IsString()
  @MinLength(6)
  password: string;
}
