import { PartialType } from '@nestjs/mapped-types';
import { CreateUnitDto } from './create-unit.dto.js';

export class UpdateUnitDto extends PartialType(CreateUnitDto) {}
