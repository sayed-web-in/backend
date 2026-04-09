import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateUnitDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  shortName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
