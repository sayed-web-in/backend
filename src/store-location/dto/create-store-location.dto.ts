import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

export class CreateStoreLocationDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  address: string;

  @IsString()
  @MaxLength(40)
  phone: string;

  @IsString()
  @MaxLength(120)
  hours: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  mapUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
