import {
  IsUUID,
  IsEnum,
  IsObject,
  IsString,
  IsBoolean,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PickupAddressDto {
  @IsString()
  line1!: string;

  @IsString()
  city!: string;

  @IsString()
  state!: string;

  @IsString()
  pincode!: string;
}

export class CreateRetrievalRequestDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  assetId!: string;

  @IsEnum(['standard', 'full_cycle'])
  bundleType: 'standard' | 'full_cycle' = 'standard';

  @IsObject()
  @ValidateNested()
  @Type(() => PickupAddressDto)
  pickupAddress!: PickupAddressDto;

  @IsString()
  contactName!: string;

  @IsString()
  contactPhone!: string;

  @IsEnum(['intra_state', 'inter_state', 'rural'])
  courierZone!: 'intra_state' | 'inter_state' | 'rural';

  @IsBoolean()
  requiresPostInspection: boolean = false;

  @IsOptional()
  @IsString()
  notes?: string;
}
