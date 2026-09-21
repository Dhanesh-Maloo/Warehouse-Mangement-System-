import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let mockPrisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let mockJwt: { sign: jest.Mock };
  let mockAudit: { log: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    mockPrisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    mockJwt = { sign: jest.fn().mockReturnValue('signed.jwt') };
    mockAudit = { log: jest.fn() };
    service = new AuthService(mockPrisma as never, mockJwt as never, mockAudit as never);
  });

  describe('validateUser', () => {
    it('rejects an invited user who has no password yet, instead of throwing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'invited',
        passwordHash: null,
        lockedUntil: null,
        failedLoginCount: 0,
      });
      await expect(service.validateUser('new.user@esevel.com', 'anything')).resolves.toBeNull();
    });
  });

  describe('validateInviteToken', () => {
    it('rejects an unknown or already-used token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.validateInviteToken('bad-token')).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        status: 'invited',
        inviteTokenExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.validateInviteToken('expired-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns the invitee identity for a live token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        status: 'invited',
        email: 'new.user@esevel.com',
        fullName: 'Esevel User',
        inviteTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
        client: { name: 'Esevel' },
      });
      await expect(service.validateInviteToken('good-token')).resolves.toEqual({
        email: 'new.user@esevel.com',
        fullName: 'Esevel User',
        clientName: 'Esevel',
      });
    });
  });

  describe('register', () => {
    it('activates the account, clears the token, and returns a session', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'invited',
        inviteTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'new.user@esevel.com',
        role: 'client_user',
        clientId: 'client-1',
      });

      const result = await service.register('good-token', 'a-new-password');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'active',
            inviteToken: null,
            inviteTokenExpiresAt: null,
          }),
        }),
      );
      expect(result.accessToken).toBe('signed.jwt');
      expect(result.user).toEqual({
        sub: 'user-1',
        email: 'new.user@esevel.com',
        role: 'client_user',
        clientId: 'client-1',
      });
    });

    it('rejects a token that was already consumed', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ status: 'active' });
      await expect(service.register('used-token', 'a-new-password')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
