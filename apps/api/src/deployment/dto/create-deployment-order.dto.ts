import {
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

  @IsUUID()
  assetId!: string;

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

  @IsEnum(['intra_state', 'inter_state', 'rural'])
  courierZone!: 'intra_state' | 'inter_state' | 'rural';

  @IsOptional()
  @IsBoolean()
  requiresLabeling?: boolean = false;

  @IsOptional()
  @IsBoolean()
  requiresRepacking?: boolean = false;

  @IsOptional()
  @IsString()
  notes?: string;
}
