import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class MarkChargesBilledDto {
  @IsUUID()
  clientId!: string;

  // Label of the charge group on the billing page (Deployment, Retrieval, ...).
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category!: string;

  // The exact ledger charges being invoiced; the server re-checks every one.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  eventIds!: string[];
}
