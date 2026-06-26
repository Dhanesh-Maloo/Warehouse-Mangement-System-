import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// 5 failures within 15 min → lock for 30 min
const MAX_FAILED = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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
