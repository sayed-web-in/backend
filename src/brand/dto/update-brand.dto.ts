import { PartialType } from '@nestjs/mapped-types';
import { CreateBrandDto } from './create-brand.dto.js';

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
