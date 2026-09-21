import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import type { CreateUserDto } from './dto/create-user.dto';

describe('UsersService', () => {
  let mockPrisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    client: { findUnique: jest.Mock };
  };
  let mockAudit: { log: jest.Mock };
  let mockMail: { send: jest.Mock };
  let mockConfig: { get: jest.Mock };
  let service: UsersService;

  const client = {
    id: 'client-1',
    name: 'Esevel',
    allowedEmailDomains: [] as string[],
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      client: { findUnique: jest.fn().mockResolvedValue(client) },
    };
    mockAudit = { log: jest.fn() };
    mockMail = { send: jest.fn() };
    mockConfig = { get: jest.fn().mockReturnValue('http://localhost:5173') };
    service = new UsersService(
      mockPrisma as never,
      mockAudit as never,
      mockMail as never,
      mockConfig as never,
    );
  });

  describe('create — internal roles', () => {
    it('requires a password', async () => {
      const dto: CreateUserDto = {
        email: 'ops@ivalueindia.com',
        fullName: 'Ops',
        role: 'operator',
      } as CreateUserDto;
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('creates an active user and sends the welcome email', async () => {
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'ops@ivalueindia.com',
        role: 'operator',
        status: 'active',
      });
      const dto: CreateUserDto = {
        email: 'ops@ivalueindia.com',
        fullName: 'Ops',
        role: 'operator',
        password: 'longenoughpassword',
      } as CreateUserDto;

      await service.create(dto);

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'ops@ivalueindia.com', role: 'operator' }),
        }),
      );
      expect(mockMail.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringContaining('created') }),
      );
    });
  });

  describe('create — client-scoped roles (invite flow)', () => {
    const dto: CreateUserDto = {
      email: 'new.user@esevel.com',
      fullName: 'Esevel User',
      role: 'client_user',
      clientId: 'client-1',
    } as CreateUserDto;

    it('rejects a password on a client-scoped role — those accounts are invited, not assigned one', async () => {
      await expect(
        service.create({ ...dto, password: 'whatever1' } as CreateUserDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires clientId', async () => {
      await expect(
        service.create({ ...dto, clientId: undefined } as CreateUserDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when the client does not exist', async () => {
      mockPrisma.client.findUnique.mockResolvedValue(null);
      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('rejects an email whose domain is not in the client allowlist', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({
        ...client,
        allowedEmailDomains: ['esevel.com'],
      });
      await expect(
        service.create({ ...dto, email: 'someone@other-company.com' } as CreateUserDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a matching domain and skips the check when no domains are configured', async () => {
      mockPrisma.client.findUnique.mockResolvedValue({
        ...client,
        allowedEmailDomains: ['esevel.com'],
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-2',
        email: 'new.user@esevel.com',
        role: 'client_user',
        status: 'invited',
      });

      await service.create(dto);

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'invited',
            passwordHash: null,
            inviteToken: expect.any(String),
          }),
        }),
      );
      expect(mockMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('register?token='),
        }),
      );
    });

    it('rejects when the email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });
});
