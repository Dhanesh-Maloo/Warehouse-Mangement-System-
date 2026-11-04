import { Controller, ForbiddenException, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @Roles('admin', 'manager', 'operator')
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): ReturnType<ClientsService['findAll']> {
    return this.clientsService.findAll(
      skip ? parseInt(skip, 10) : 0,
      take ? parseInt(take, 10) : 50,
    );
  }

  /** Readable by every role, but client-scoped users only for their own client. */
  @Get(':id/transport-pricing')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  transportPricing(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<ClientsService['getTransportPricing']> {
    const scoped = ['client_user', 'editor', 'client_admin'].includes(user.role);
    if (scoped && user.clientId !== id) {
      throw new ForbiddenException('Cannot read another client');
    }
    return this.clientsService.getTransportPricing(id);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator')
  findOne(@Param('id') id: string): ReturnType<ClientsService['findOne']> {
    return this.clientsService.findOne(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateClientDto): ReturnType<ClientsService['create']> {
    return this.clientsService.create(dto);
  }

  // The Clients page edits with PATCH; PUT is kept for existing callers.
  @Put(':id')
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateClientDto>,
  ): ReturnType<ClientsService['update']> {
    return this.clientsService.update(id, dto);
  }

  /** Soft delete (isActive=false) — a client with assets/ledger history can never be hard-deleted. */
  @Delete(':id')
  @Roles('admin')
  deactivate(@Param('id') id: string): ReturnType<ClientsService['deactivate']> {
    return this.clientsService.deactivate(id);
  }
}
