import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { welcomeEmail } from '../mail/templates/welcome';
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

// clientId: null means "internal staff, sees everything" throughout this
// codebase — so a client-scoped role must never be paired with a null
// clientId. Mirrors the set of the same name in users.controller.ts.
const CLIENT_SCOPED_ROLES = new Set(['client_user', 'editor', 'client_admin']);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
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

  /**
   * Lightweight user picker list — id/fullName/role only, no email/phone.
   * Used to populate "who handled this" dropdowns (e.g. retrieval owner).
   * Always includes internal staff (clientId null); a client-scoped caller
   * additionally sees their own client's users, never another client's.
   */
  async findDirectory(
    callerClientId?: string,
  ): Promise<{ id: string; fullName: string; role: string }[]> {
    return this.prisma.user.findMany({
      where: {
        status: 'active',
        OR: [{ clientId: null }, ...(callerClientId ? [{ clientId: callerClientId }] : [])],
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  }

  /**
   * Active users' emails for the given roles — used to notify approvers
   * (e.g. manager/admin) of events like a new disposal or resale request.
   */
  async findEmailsByRoles(roles: string[]): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { status: 'active', role: { in: roles as never[] } },
      select: { email: true },
    });
    return users.map((u) => u.email);
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

    const { subject, html, text } = welcomeEmail(user.fullName);
    void this.mail.send({ to: user.email, subject, html, text });

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
    const existing = await this.findOne(id);

    // Re-validate the merged (post-update) state rather than trusting DTO
    // validation alone: PartialType marks every field @IsOptional(), which
    // short-circuits the inherited @ValidateIf-gated clientId check on
    // CreateUserDto whenever clientId is omitted or sent as null — so an
    // admin could otherwise flip role to client_admin/editor/client_user
    // while leaving (or setting) clientId to null.
    const nextRole = dto.role ?? existing.role;
    const nextClientId = dto.clientId !== undefined ? dto.clientId : existing.clientId;
    if (CLIENT_SCOPED_ROLES.has(nextRole) && !nextClientId) {
      throw new BadRequestException(
        `Role '${nextRole}' requires a clientId — provide one in this request`,
      );
    }

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
