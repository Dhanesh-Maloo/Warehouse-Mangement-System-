import { IsString, IsEmail, IsOptional, Matches, IsObject, IsInt, Min } from 'class-validator';

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export class CreateClientDto {
  @IsString()
  name!: string;

  @IsString()
  slug!: string;

  @IsOptional()
  @IsString()
  @Matches(GSTIN_REGEX, { message: 'gstin must be a valid 15-character GSTIN' })
  gstin?: string;

  @IsOptional()
  @IsObject()
  billingAddress?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  // Monthly minimum committed storage spend — all three must be set together
  // to enable a commitment (see StorageService); omit all three for none.
  @IsOptional()
  @IsInt()
  @Min(0)
  commitmentAmountPaise?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  commitmentLaptopCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  commitmentPeripheralCount?: number;
}
