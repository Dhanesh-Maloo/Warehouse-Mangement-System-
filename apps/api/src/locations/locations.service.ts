import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type { Location } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateLocationDto {
  name: string;
  zoneCode: string;
  binCode: string;
  description?: string;
  capacity?: number;
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): import('@prisma/client').Prisma.PrismaPromise<
    import('@prisma/client').Prisma.LocationGetPayload<{
      include: { _count: { select: { assets: true } } };
    }>[]
  > {
    return this.prisma.location.findMany({
      include: { _count: { select: { assets: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateLocationDto): Promise<Location> {
    const existing = await this.prisma.location.findUnique({
      where: { zoneCode_binCode: { zoneCode: dto.zoneCode, binCode: dto.binCode } },
    });
    if (existing)
      throw new ConflictException(`Location ${dto.zoneCode}-${dto.binCode} already exists`);
    return this.prisma.location.create({ data: dto });
  }

  async update(id: string, dto: Partial<CreateLocationDto>): Promise<Location> {
    const existing = await this.prisma.location.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Location ${id} not found`);
    return this.prisma.location.update({ where: { id }, data: dto });
  }

  async delete(id: string): Promise<void> {
    const location = await this.prisma.location.findUnique({
      where: { id },
      include: { _count: { select: { assets: true } } },
    });
    if (!location) throw new NotFoundException(`Location ${id} not found`);
    if (location._count.assets > 0) {
      throw new BadRequestException(
        `Cannot delete location with ${location._count.assets} asset(s) assigned to it`,
      );
    }
    await this.prisma.location.delete({ where: { id } });
  }
}
