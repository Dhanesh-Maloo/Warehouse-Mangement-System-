import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { LocationsService, CreateLocationDto } from './locations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(): ReturnType<LocationsService['findAll']> {
    return this.locationsService.findAll();
  }

  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateLocationDto): ReturnType<LocationsService['create']> {
    return this.locationsService.create(dto);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateLocationDto>,
  ): ReturnType<LocationsService['update']> {
    return this.locationsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string): Promise<void> {
    return this.locationsService.delete(id);
  }
}
