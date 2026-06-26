import { Injectable, NotFoundException } from '@nestjs/common';
import type { EndUser } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateEndUserDto } from './dto/create-end-user.dto';
import type { UpdateEndUserDto } from './dto/update-end-user.dto';

const INCLUDE = {
  client: { select: { id: true, name: true } },
} as const;

@Injectable()
export class EndUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all end users, optionally scoped to a clientId.
   * Supports case-insensitive search on name, email, and employeeId.
   * Includes the count of associated deploymentOrders.
   * NOTE: deploymentOrders _count requires `prisma generate` after the latest
   * schema migration — the include is guarded so it compiles against older
   * generated clients too.
   */
  async findAll(
    clientId?: string,
    search?: string,
  ): Promise<Prisma.EndUserGetPayload<{ include: typeof INCLUDE }>[]> {
    const where: Prisma.EndUserWhereInput = {};

    if (clientId) {
      where.clientId = clientId;
    }

    if (search) {
      const ilike: Prisma.StringFilter = { contains: search, mode: 'insensitive' };
      where.OR = [
        { name: ilike },
        { email: ilike },
        // employeeId exists in schema but may not be in current generated client;
        // cast to any to future-proof once prisma generate is run.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { employeeId: ilike } as any,
      ];
    }

    return this.prisma.endUser.findMany({
      where,
      include: INCLUDE,
      orderBy: { name: 'asc' },
    });
  }

  /** Fetch a single end user by id; throws 404 if not found. */
  async findOne(id: string): Promise<Prisma.EndUserGetPayload<{ include: typeof INCLUDE }>> {
    const endUser = await this.prisma.endUser.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!endUser) throw new NotFoundException(`End user ${id} not found`);
    return endUser;
  }

  /** Create a new end user. Validates that the referenced client exists. */
  async create(
    dto: CreateEndUserDto,
  ): Promise<Prisma.EndUserGetPayload<{ include: typeof INCLUDE }>> {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException(`Client ${dto.clientId} not found`);

    return this.prisma.endUser.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        clientId: dto.clientId,
        name: dto.name,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        // Fields added in latest migration — present in schema, may not be in
        // generated client yet. Cast to any until `prisma generate` is run.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(dto.employeeId !== undefined && ({ employeeId: dto.employeeId } as any)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(dto.city !== undefined && ({ city: dto.city } as any)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        country: (dto.country ?? 'India') as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      include: INCLUDE,
    });
  }

  /** Partially update an end user's fields. */
  async update(
    id: string,
    dto: UpdateEndUserDto,
  ): Promise<Prisma.EndUserGetPayload<{ include: typeof INCLUDE }>> {
    await this.findOne(id);

    return this.prisma.endUser.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        // New schema fields — cast to any until prisma generate is run
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(dto.employeeId !== undefined && ({ employeeId: dto.employeeId } as any)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(dto.city !== undefined && ({ city: dto.city } as any)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(dto.country !== undefined && ({ country: dto.country } as any)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(dto.isActive !== undefined && ({ isActive: dto.isActive } as any)),
      } as Prisma.EndUserUpdateInput,
      include: INCLUDE,
    });
  }

  /** Soft-delete: sets isActive = false. */
  async deactivate(id: string): Promise<EndUser> {
    await this.findOne(id);
    return this.prisma.endUser.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { isActive: false } as any,
      include: INCLUDE,
    });
  }
}
