import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StorefrontLinkDto {
  @IsString()
  @MaxLength(80)
  label: string;

  @IsString()
  @MaxLength(255)
  href: string;
}

export enum HeaderBrandMode {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
}

export class UpsertStorefrontSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  topPhoneLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  topPhoneHref?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StorefrontLinkDto)
  topLinks?: StorefrontLinkDto[];

  @IsOptional()
  @IsEnum(HeaderBrandMode)
  headerBrandMode?: HeaderBrandMode;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brandName?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  brandLogoUrl?: string;

  @IsOptional()
  @IsString()
  footerDescription?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StorefrontLinkDto)
  footerQuickLinks?: StorefrontLinkDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StorefrontLinkDto)
  footerCustomerLinks?: StorefrontLinkDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  footerAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  footerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  footerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  footerHours?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  copyrightText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  marketingGtmContainerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  marketingPublicSiteUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  marketingGtmCurrency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  marketingMetaPixelId?: string;
}
