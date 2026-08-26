import { IsOptional, IsString } from 'class-validator';

// Shared shape for the "edit ticket numbers after creation" endpoint on every
// module that tracks work against a ticket (inbound, retrieval, deployment,
// disposal, repair).
export class UpdateTicketsDto {
  @IsOptional()
  @IsString()
  ivalueTicketNumber?: string;

  @IsOptional()
  @IsString()
  clientTicketNumber?: string;
}
