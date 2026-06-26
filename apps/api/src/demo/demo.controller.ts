import { Controller, Post, Delete, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { DemoService } from './demo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('demo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Get('status')
  getStatus(): ReturnType<DemoService['getStatus']> {
    return this.demoService.getStatus();
  }

  @Post('seed')
  @HttpCode(HttpStatus.CREATED)
  seed(): ReturnType<DemoService['seed']> {
    return this.demoService.seed();
  }

  @Delete('seed')
  @HttpCode(HttpStatus.OK)
  teardown(): ReturnType<DemoService['teardown']> {
    return this.demoService.teardown();
  }
}
