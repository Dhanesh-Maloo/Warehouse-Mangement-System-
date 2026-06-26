import type { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string; // user_id
  email: string;
  role: UserRole;
  clientId: string | null;
}
