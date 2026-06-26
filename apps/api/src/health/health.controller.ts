import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { HealthResponse } from '@warehouse/shared'; // type-only: erased at compile time

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    let database: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }

    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database,
    };
  }
}
