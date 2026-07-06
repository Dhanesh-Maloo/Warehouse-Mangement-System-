import { IsString, IsOptional, Matches } from 'class-validator';

export class AddRuralPincodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pincode must be exactly 6 digits' })
  pincode!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
