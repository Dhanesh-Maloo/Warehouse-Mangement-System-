import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

type SafeUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: string;
  clientId: string | null;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
};

const SELECT_SAFE = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  clientId: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    skip = 0,
    take = 50,
    clientId?: string,
  ): Promise<{ data: SafeUser[]; total: number }> {
    const where = clientId ? { clientId } : {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: SELECT_SAFE,
        orderBy: { fullName: 'asc' },
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, total };
  }

  async findOne(id: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SELECT_SAFE });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async create(dto: CreateUserDto): Promise<SafeUser> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with that email already exists');

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName,
        phone: dto.phone,
        role: dto.role,
        clientId: dto.clientId ?? null,
      },
      select: SELECT_SAFE,
    });
    await this.audit.log({
      userId: user.id,
      action: 'user.create',
      entity: 'User',
      entityId: user.id,
      newValue: { email: user.email, role: user.role },
    });
    return user;
  }

  async setStatus(id: string, status: 'active' | 'suspended'): Promise<SafeUser> {
    await this.findOne(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { status },
      select: SELECT_SAFE,
    });
    await this.audit.log({
      userId: id,
      action: 'user.setStatus',
      entity: 'User',
      entityId: id,
      newValue: { status },
    });
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    await this.findOne(id);

    const data: Record<string, unknown> = { ...dto };
    if (dto.password) {
      data.passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
      delete data.password;
    }
    if (dto.email) {
      data.email = dto.email.toLowerCase().trim();
      const emailConflict = await this.prisma.user.findUnique({
        where: { email: data.email as string },
      });
      if (emailConflict && emailConflict.id !== id) {
        throw new ConflictException('A user with that email already exists');
      }
    }

    const user = await this.prisma.user.update({ where: { id }, data, select: SELECT_SAFE });
    await this.audit.log({
      userId: id,
      action: 'user.update',
      entity: 'User',
      entityId: id,
      newValue: dto,
    });
    return user;
  }
}
