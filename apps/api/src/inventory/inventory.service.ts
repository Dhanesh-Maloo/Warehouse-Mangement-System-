import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface InventoryFilter {
  clientId?: string;
  locationId?: string;
  status?: string;
  skip?: number;
  take?: number;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filter: InventoryFilter): Promise<{ data: unknown[]; total: number }> {
    const where = {
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.locationId ? { currentLocationId: filter.locationId } : {}),
      ...(filter.status ? { currentStatus: filter.status as never } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        include: {
          currentLocation: true,
          disposalRequests: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { disposalType: true, certificateS3Key: true, status: true },
          },
          deploymentOrders: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              dispatchedAt: true,
              deliveredAt: true,
              trackingNumber: true,
              courierName: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: filter.skip ?? 0,
        take: filter.take ?? 50,
      }),
      this.prisma.asset.count({ where }),
    ]);

    return { data, total };
  }

  async summary(clientId?: string): Promise<Record<string, number>> {
    const statuses = [
      'receiving',
      'in_inspection',
      'in_storage',
      'deployed',
      'returning',
      'disposed',
    ] as const;

    const counts = await Promise.all(
      statuses.map((s) =>
        this.prisma.asset.count({
          where: { currentStatus: s, ...(clientId ? { clientId } : {}) },
        }),
      ),
    );

    return Object.fromEntries(statuses.map((s, i) => [s, counts[i]]));
  }
}
