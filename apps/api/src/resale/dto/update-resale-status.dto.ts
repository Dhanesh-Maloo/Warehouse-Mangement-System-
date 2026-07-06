import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateResaleStatusDto {
  @IsEnum(['listed', 'sold', 'cancelled'])
  status!: 'listed' | 'sold' | 'cancelled';

  @IsOptional()
  @IsInt()
  @Min(0)
  soldPricePaise?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
