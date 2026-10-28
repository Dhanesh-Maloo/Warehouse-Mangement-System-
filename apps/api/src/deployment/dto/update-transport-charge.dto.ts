import { IsInt, Max, Min } from 'class-validator';

export class UpdateTransportChargeDto {
  // Total transport charge for the order in paise (not an increment). 0 clears it.
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  transportChargePaise!: number;
}
