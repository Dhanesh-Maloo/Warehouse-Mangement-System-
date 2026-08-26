import {
  IsUUID,
  IsEnum,
  IsObject,
  IsString,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  ValidateNested,
  ValidateIf,
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

export class RedeployDeliveryAddressDto {
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

  @IsBoolean()
  requiresPostInspection: boolean = false;

  // Placeholder — captured but not yet executed automatically. The actual
  // wipe is expected to be recorded via the existing Inspection
  // sanitization/factoryReset checklist fields when the post-retrieval
  // inspection is completed.
  @IsOptional()
  @IsBoolean()
  requiresWipe?: boolean = false;

  // Only meaningful when bundleType = 'full_cycle'. Determines whether the
  // auto-created redeploy Deployment order uses 'full_prep' vs 'standard'.
  @IsOptional()
  @IsBoolean()
  requiresRedeploySetup?: boolean = false;

  // Redeploy destination — required when bundleType = 'full_cycle' so that a
  // clean ("no damage") post-retrieval inspection result can auto-create the
  // Deployment order to the new user.
  @ValidateIf((o: CreateRetrievalRequestDto) => o.bundleType === 'full_cycle')
  @IsUUID()
  redeployEndUserId?: string;

  @ValidateIf((o: CreateRetrievalRequestDto) => o.bundleType === 'full_cycle')
  @IsObject()
  @ValidateNested()
  @Type(() => RedeployDeliveryAddressDto)
  redeployDeliveryAddress?: RedeployDeliveryAddressDto;

  @ValidateIf((o: CreateRetrievalRequestDto) => o.bundleType === 'full_cycle')
  @IsString()
  redeployContactName?: string;

  @ValidateIf((o: CreateRetrievalRequestDto) => o.bundleType === 'full_cycle')
  @IsString()
  redeployContactPhone?: string;

  @IsOptional()
  @IsString()
  ivalueTicketNumber?: string;

  @IsString()
  @IsNotEmpty()
  clientTicketNumber!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Who physically handled/is handling this retrieval. Defaults to the
  // logged-in user when omitted; overridable (e.g. an admin logging a
  // retrieval on a field operator's behalf).
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
