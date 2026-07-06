import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateResaleListingDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  assetId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  listedPricePaise?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
