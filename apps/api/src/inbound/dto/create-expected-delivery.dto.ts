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
} from 'class-validator';
import { Type } from 'class-transformer';
import { AssetCategory } from '@prisma/client';

export class ExpectedDeliveryItemDto {
  @IsEnum(AssetCategory)
  category!: AssetCategory;

  @IsString()
  model!: string;

  @IsString()
  manufacturer!: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity!: number;
}

export class CreateExpectedDeliveryDto {
  @IsUUID()
  clientId!: string;

  @IsString()
  purchaseOrderRef!: string;

  @IsDateString()
  expectedArrivalDate!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpectedDeliveryItemDto)
  items!: ExpectedDeliveryItemDto[];

  @IsOptional()
  @IsString()
  ivalueTicketNumber?: string;

  @IsOptional()
  @IsString()
  clientTicketNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
