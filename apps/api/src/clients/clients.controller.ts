import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

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

  @Put(':id')
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
