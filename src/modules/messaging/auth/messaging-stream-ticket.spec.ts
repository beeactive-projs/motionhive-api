import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { JwtStrategy } from '../../auth/strategies/jwt.strategy';
import { TokenTypes, type JwtPayload } from '../../auth/types/jwt-payload';
import { RoleService } from '../../role/role.service';
import { UserService } from '../../user/user.service';
import {
  MessagingStreamTicketService,
  STREAM_TICKET_TTL_SECONDS,
} from './messaging-stream-ticket.service';
import { SseJwtStrategy } from './sse-jwt.strategy';

/**
 * The stream ticket exists to keep a real credential out of a URL. These
 * tests pin the two halves that make that true: the ticket is short-lived
 * and stream-scoped, and every other door is shut to it. If the scoping
 * regresses, the ticket silently becomes a plain access token with a
 * shorter expiry — and a URL full of them is back to being a liability.
 */
describe('messaging stream ticket', () => {
  const SECRET = 'test-secret';
  const configService = {
    get: (key: string) => (key === 'JWT_SECRET' ? SECRET : undefined),
  } as unknown as ConfigService;

  const activeUser = { id: 'u-1', isActive: true };
  const userService = {
    findById: jest.fn().mockResolvedValue(activeUser),
  } as unknown as UserService & { findById: jest.Mock };

  const roleService = {
    getUserRoleNames: jest.fn().mockResolvedValue(['USER']),
  } as unknown as RoleService;

  const jwtService = new JwtService({ secret: SECRET });
  const tickets = new MessagingStreamTicketService(jwtService);

  const req = (query: Record<string, string>) =>
    ({ query }) as unknown as Request;

  beforeEach(() => {
    (userService.findById as jest.Mock).mockClear();
    (userService.findById as jest.Mock).mockResolvedValue(activeUser);
  });

  describe('the ticket itself', () => {
    it('carries the stream type and the user, and expires in a minute', () => {
      const { ticket, expiresIn } = tickets.issue('u-1');
      const payload = jwtService.verify<JwtPayload>(ticket);

      expect(expiresIn).toBe(STREAM_TICKET_TTL_SECONDS);
      expect(payload.sub).toBe('u-1');
      expect(payload.typ).toBe(TokenTypes.STREAM_TICKET);
      expect(payload.exp! - payload.iat!).toBe(STREAM_TICKET_TTL_SECONDS);
    });
  });

  describe('every other endpoint', () => {
    it('refuses a stream ticket', async () => {
      const strategy = new JwtStrategy(configService, userService, roleService);
      const { ticket } = tickets.issue('u-1');
      const payload = jwtService.verify<JwtPayload>(ticket);

      await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // Rejected on the claim alone — never even looked the user up.
      expect(userService.findById).not.toHaveBeenCalled();
    });

    it('still accepts a normal access token', async () => {
      const strategy = new JwtStrategy(configService, userService, roleService);
      (userService.findById as jest.Mock).mockResolvedValue({
        id: 'u-1',
        isActive: true,
        passwordChangedAt: null,
        get: () => ({ id: 'u-1' }),
      });

      await expect(
        strategy.validate({ sub: 'u-1' } as JwtPayload),
      ).resolves.toEqual(expect.objectContaining({ id: 'u-1' }));
    });
  });

  describe('the stream endpoint', () => {
    const strategy = () => new SseJwtStrategy(configService, userService);

    it('accepts a ticket presented as ?ticket=', async () => {
      const payload = jwtService.verify<JwtPayload>(
        tickets.issue('u-1').ticket,
      );

      await expect(
        strategy().validate(req({ ticket: 'x' }), payload),
      ).resolves.toEqual({ id: 'u-1' });
    });

    it('refuses an access token dressed up as ?ticket=', async () => {
      // Otherwise the leak just moves to a new parameter name.
      await expect(
        strategy().validate(req({ ticket: 'x' }), { sub: 'u-1' } as JwtPayload),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses a ticket sent anywhere but the ticket parameter', async () => {
      const payload = jwtService.verify<JwtPayload>(
        tickets.issue('u-1').ticket,
      );

      await expect(
        strategy().validate(req({}), payload),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('still accepts a legacy ?token= access token, for clients not yet updated', async () => {
      await expect(
        strategy().validate(req({ token: 'x' }), { sub: 'u-1' } as JwtPayload),
      ).resolves.toEqual({ id: 'u-1' });
    });

    it('refuses a deactivated user holding a valid ticket', async () => {
      (userService.findById as jest.Mock).mockResolvedValue({
        id: 'u-1',
        isActive: false,
      });
      const payload = jwtService.verify<JwtPayload>(
        tickets.issue('u-1').ticket,
      );

      await expect(
        strategy().validate(req({ ticket: 'x' }), payload),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
