import { PartialType } from '@nestjs/mapped-types';
import { CreateStoreLocationDto } from './create-store-location.dto.js';

export class UpdateStoreLocationDto extends PartialType(CreateStoreLocationDto) {}
