import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditFilter {
  userId?: string;
  entity?: string;
  action?: string;
  from?: string;
  to?: string;
  skip?: number;
  take?: number;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: {
    userId: string;
    action: string;
    entity: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
    ipAddress?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        ...(entry.oldValue !== undefined
          ? { oldValue: entry.oldValue as import('@prisma/client').Prisma.InputJsonValue }
          : {}),
        ...(entry.newValue !== undefined
          ? { newValue: entry.newValue as import('@prisma/client').Prisma.InputJsonValue }
          : {}),
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }

  async findMany(filter: AuditFilter): Promise<{ data: unknown[]; total: number }> {
    const where = {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.entity ? { entity: filter.entity } : {}),
      ...(filter.action
        ? { action: { contains: filter.action, mode: 'insensitive' as const } }
        : {}),
      ...(filter.from || filter.to
        ? {
            occurredAt: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to
                ? (() => {
                    const d = new Date(filter.to);
                    if (!filter.to.includes('T')) d.setDate(d.getDate() + 1);
                    return { lt: d };
                  })()
                : {}),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, email: true } } },
        orderBy: { occurredAt: 'desc' },
        skip: filter.skip ?? 0,
        take: filter.take ?? 50,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total };
  }
}
