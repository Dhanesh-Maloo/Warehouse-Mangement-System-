import { IsString, IsUUID, Matches } from 'class-validator';

export class MarkInboundBilledDto {
  @IsUUID()
  clientId!: string;

  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'billingMonth must be in YYYY-MM format' })
  billingMonth!: string;
}
