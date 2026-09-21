import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// Stands in for the real passport JWT strategy: reads a test-only header
// instead of decoding a bearer token, so the controller/RolesGuard pipeline
// can be exercised over real HTTP without standing up passport + a signer.
class FakeJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: JwtPayload;
    }>();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException();
    req.user = {
      sub: 'test-user',
      email: 'test@example.com',
      role: role as JwtPayload['role'],
      clientId: req.headers['x-test-client-id'] ?? null,
    };
    return true;
  }
}

describe('AssetsController (integration)', () => {
  let app: INestApplication;
  const mockAssetsService = {
    findAllForExport: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AssetsController],
      providers: [{ provide: AssetsService, useValue: mockAssetsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockAssetsService.findAllForExport.mockReset();
  });

  describe('GET /assets/export', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/assets/export').expect(401);
      expect(mockAssetsService.findAllForExport).not.toHaveBeenCalled();
    });

    it('returns a CSV attachment of the full register for an authorized admin', async () => {
      mockAssetsService.findAllForExport.mockResolvedValue([
        {
          serialNumber: 'SN-1',
          assetTag: 'AT-1',
          referenceName: null,
          vendorName: 'Dell',
          model: 'Latitude 5540',
          manufacturer: 'Dell',
          category: 'laptop',
          clientId: 'client-1',
          currentStatus: 'in_storage',
          assetCondition: 'new',
          conditionGrade: 'A',
          currentLocation: { id: 'loc-1', name: 'Bangalore WH' },
          awbNumber: null,
          courierName: null,
          deliveredAt: null,
          disposalType: null,
          hasCertification: false,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/assets/export?assetCondition=new')
        .set('x-test-role', 'admin')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('asset-register-export.csv');
      expect(res.text).toContain('SN-1');
      expect(res.text).toContain('Bangalore WH');
      expect(mockAssetsService.findAllForExport).toHaveBeenCalledWith(
        expect.objectContaining({ assetCondition: 'new' }),
      );
    });

    // Non-negotiable multi-tenancy rule: a client_user's own clientId must
    // be used regardless of what clientId (if any) is on the query string.
    it('scopes a client_user to their own client, ignoring any clientId in the query', async () => {
      mockAssetsService.findAllForExport.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/assets/export?clientId=someone-elses-client')
        .set('x-test-role', 'client_user')
        .set('x-test-client-id', 'my-client')
        .expect(200);

      expect(mockAssetsService.findAllForExport).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'my-client' }),
      );
    });
  });
});
