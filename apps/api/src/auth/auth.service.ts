import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// 5 failures within 15 min → lock for 30 min
const MAX_FAILED = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async validateUser(rawEmail: string, password: string): Promise<JwtPayload | null> {
    const email = rawEmail.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Constant-time rejection — don't leak whether the email exists
      await argon2.hash('dummy-constant-time');
      return null;
    }

    if (user.status === 'suspended') {
      throw new ForbiddenException('Account suspended. Contact your administrator.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(`Account locked. Try again in ${minutesLeft} minute(s).`);
    }

    // Invited users have no password yet — nothing to verify against.
    if (!user.passwordHash) {
      return null;
    }

    const valid = await argon2.verify(user.passwordHash, password);

    if (!valid) {
      const failCount = user.failedLoginCount + 1;
      const lock = failCount >= MAX_FAILED ? new Date(Date.now() + LOCK_DURATION_MS) : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failCount, lockedUntil: lock },
      });
      return null;
    }

    // Successful login — reset failure counters
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      clientId: user.clientId,
    };
  }

  login(payload: JwtPayload): { accessToken: string; user: JwtPayload } {
    return {
      accessToken: this.jwt.sign(payload),
      user: payload,
    };
  }

  /** Looks up an invite by token without consuming it — powers the register page's initial load. */
  async validateInviteToken(
    token: string,
  ): Promise<{ email: string; fullName: string; clientName: string }> {
    const user = await this.prisma.user.findUnique({
      where: { inviteToken: token },
      include: { client: true },
    });
    if (!user || user.status !== 'invited') {
      throw new BadRequestException('This invite link is invalid or has already been used.');
    }
    if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt < new Date()) {
      throw new BadRequestException(
        'This invite link has expired. Ask your account admin to send a new one.',
      );
    }
    return {
      email: user.email,
      fullName: user.fullName,
      clientName: user.client?.name ?? '',
    };
  }

  /** Consumes an invite token, sets the password, and activates the account. */
  async register(
    token: string,
    password: string,
  ): Promise<{ accessToken: string; user: JwtPayload }> {
    const user = await this.prisma.user.findUnique({ where: { inviteToken: token } });
    if (!user || user.status !== 'invited') {
      throw new BadRequestException('This invite link is invalid or has already been used.');
    }
    if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt < new Date()) {
      throw new BadRequestException(
        'This invite link has expired. Ask your account admin to send a new one.',
      );
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: 'active',
        inviteToken: null,
        inviteTokenExpiresAt: null,
        lastLoginAt: new Date(),
      },
    });
    await this.audit.log({
      userId: updated.id,
      action: 'user.register',
      entity: 'User',
      entityId: updated.id,
      newValue: { email: updated.email },
    });

    const payload: JwtPayload = {
      sub: updated.id,
      email: updated.email,
      role: updated.role,
      clientId: updated.clientId,
    };
    return { accessToken: this.jwt.sign(payload), user: payload };
  }

  async me(userId: string): Promise<{
    id: string;
    email: string;
    fullName: string;
    role: string;
    clientId: string | null;
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, clientId: true },
    });
    return user;
  }
}
