import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { RateCardService } from './rate-card.service';
import { CreateRateCardItemDto } from './dto/create-rate-card-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rate-card')
export class RateCardController {
  constructor(private readonly rateCardService: RateCardService) {}

  @Get()
  @Roles('admin', 'manager')
  findAll(): ReturnType<RateCardService['findAll']> {
    return this.rateCardService.findAll();
  }

  @Get('current')
  @Roles('admin', 'manager', 'operator')
  findCurrent(): ReturnType<RateCardService['findCurrent']> {
    return this.rateCardService.findCurrent();
  }

  @Get(':id')
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string): ReturnType<RateCardService['findOne']> {
    return this.rateCardService.findOne(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateRateCardItemDto): ReturnType<RateCardService['create']> {
    return this.rateCardService.create(dto);
  }
}
