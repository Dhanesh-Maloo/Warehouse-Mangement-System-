import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryAddressDto } from './create-deployment-order.dto';

/**
 * Everything on a deployment order that can be corrected after creation. Every field is optional;
 * only the ones sent are changed. Assets and bundle options are not editable: they decide the
 * charges already on the ledger.
 */
export class UpdateDeploymentOrderDto {
  // null clears the end user.
  @IsOptional()
  @IsUUID()
  endUserId?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress?: DeliveryAddressDto;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  contactName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  contactPhone?: string;

  // Empty string clears these four.
  @IsOptional()
  @IsString()
  ivalueTicketNumber?: string;

  @IsOptional()
  @IsString()
  clientTicketNumber?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  courierName?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Total transport charge in paise (not an increment); the difference is posted to the ledger.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  transportChargePaise?: number;
}
