import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { tenantStorage } from './tenant-context';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(
    req: Request & { user?: { clientId?: string | null } },
    _res: Response,
    next: NextFunction,
  ): void {
    const clientId = req.user?.clientId ?? null;
    tenantStorage.run({ clientId }, () => next());
  }
}
