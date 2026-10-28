import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Max,
  Min,
  IsUUID,
  IsEnum,
  IsBoolean,
  IsObject,
  IsString,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DeliveryAddressDto {
  @IsString()
  line1!: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsString()
  city!: string;

  @IsString()
  state!: string;

  @IsString()
  pincode!: string;
}

export class CreateDeploymentOrderDto {
  @IsUUID()
  clientId!: string;

  // All assets travelling in this one shipment. Charges: courier once per
  // order; bundle, labeling and repacking once per asset.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assetIds!: string[];

  @IsOptional()
  @IsUUID()
  endUserId?: string;

  @IsOptional()
  @IsEnum(['standard', 'full_prep'])
  bundleType?: 'standard' | 'full_prep' = 'standard';

  @IsObject()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress!: DeliveryAddressDto;

  @IsString()
  contactName!: string;

  @IsString()
  contactPhone!: string;

  // Manual transport (courier) charge in paise. Entered by the operator because the
  // real cost varies per shipment; 0 / omitted means no transport charge is billed.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  transportChargePaise?: number;

  @IsOptional()
  @IsBoolean()
  requiresLabeling?: boolean = false;

  @IsOptional()
  @IsBoolean()
  requiresRepacking?: boolean = false;

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
