import {
  IsString,
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  IsEnum,
  IsInt,
  Min,
  IsOptional,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AssetCategory } from '@prisma/client';

export class UpdateExpectedDeliveryItemDto {
  // Present for an existing line; omitted for a newly added one.
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsEnum(AssetCategory)
  category!: AssetCategory;

  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsString()
  @IsNotEmpty()
  manufacturer!: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity!: number;
}

export class UpdateExpectedDeliveryDto {
  @IsOptional()
  @IsString()
  purchaseOrderRef?: string;

  @IsOptional()
  @IsDateString()
  expectedArrivalDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  ivalueTicketNumber?: string;

  @IsOptional()
  @IsString()
  clientTicketNumber?: string;

  // When provided, replaces the delivery's line items (lines not listed are removed).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateExpectedDeliveryItemDto)
  items?: UpdateExpectedDeliveryItemDto[];
}
