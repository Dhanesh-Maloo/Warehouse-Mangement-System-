import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateRetrievalStatusDto {
  @IsEnum(['initiated', 'in_transit', 'received', 'completed', 'cancelled'])
  status!: 'initiated' | 'in_transit' | 'received' | 'completed' | 'cancelled';

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
