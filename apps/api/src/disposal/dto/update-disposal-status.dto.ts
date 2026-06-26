import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateDisposalStatusDto {
  @IsEnum(['approved', 'in_progress', 'completed', 'cancelled'])
  status!: 'approved' | 'in_progress' | 'completed' | 'cancelled';

  @IsString()
  @IsOptional()
  notes?: string;
}
