import {
  IsUUID,
  IsArray,
  ValidateNested,
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AssetCategory } from '@prisma/client';

export class ReceivedDeviceDto {
  @IsString()
  serialNumber!: string;

  @IsString()
  model!: string;

  @IsString()
  manufacturer!: string;

  @IsEnum(AssetCategory)
  category!: AssetCategory;

  @IsOptional()
  @IsString()
  assetTag?: string;

  @IsBoolean()
  requiresInspection!: boolean;
}

export class ReceiveDevicesDto {
  @IsUUID()
  expectedDeliveryId!: string;

  @IsUUID()
  receivingLocationId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivedDeviceDto)
  devices!: ReceivedDeviceDto[];

  @IsOptional()
  @IsString()
  courierRef?: string;

  @IsOptional()
  @IsBoolean()
  forceOverride?: boolean;
}
