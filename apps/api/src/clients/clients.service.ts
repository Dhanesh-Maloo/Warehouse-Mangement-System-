import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Client } from '@prisma/client';
import type { CreateClientDto } from './dto/create-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(skip = 0, take = 50): Promise<{ data: Client[]; total: number }> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({ orderBy: { name: 'asc' }, skip, take }),
      this.prisma.client.count(),
    ]);
    return { data, total };
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return client;
  }

  async create(dto: CreateClientDto): Promise<Client> {
    const client = await this.prisma.client.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        gstin: dto.gstin,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        billingAddress: dto.billingAddress as any,
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        committedMonthlyAmountPaise: BigInt(dto.committedMonthlyAmountPaise ?? 4_275_000),
      },
    });
    await this.audit.log({
      userId: 'system',
      action: 'client.create',
      entity: 'Client',
      entityId: client.id,
      newValue: { name: client.name, slug: client.slug },
    });
    return client;
  }

  async update(id: string, dto: Partial<CreateClientDto>): Promise<Client> {
    await this.findOne(id);
    const { billingAddress, committedMonthlyAmountPaise, ...rest } = dto;
    const client = await this.prisma.client.update({
      where: { id },
      data: {
        ...rest,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(billingAddress !== undefined ? { billingAddress: billingAddress as any } : {}),
        ...(committedMonthlyAmountPaise !== undefined
          ? { committedMonthlyAmountPaise: BigInt(committedMonthlyAmountPaise) }
          : {}),
      },
    });
    await this.audit.log({
      userId: 'system',
      action: 'client.update',
      entity: 'Client',
      entityId: id,
      newValue: dto,
    });
    return client;
  }
}
