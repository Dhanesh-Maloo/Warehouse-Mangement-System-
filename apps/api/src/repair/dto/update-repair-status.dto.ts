import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateRepairStatusDto {
  @IsEnum(['pending', 'sent', 'in_repair', 'returned', 'completed', 'cancelled'])
  status!: 'pending' | 'sent' | 'in_repair' | 'returned' | 'completed' | 'cancelled';

  @IsString()
  @IsOptional()
  notes?: string;
}
