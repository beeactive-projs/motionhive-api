import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { TokenTypes, type JwtPayload } from '../../auth/types/jwt-payload';
import { UserService } from '../../user/user.service';

/**
 * Second JWT strategy, dedicated to the SSE stream.
 *
 * Reasoning: browser `EventSource` cannot set custom request headers,
 * so nothing can go in `Authorization: Bearer`. Something has to ride in
 * the query string instead. We MUST NOT change the default `'jwt'`
 * strategy to also accept query tokens — that would weaken every
 * authenticated REST endpoint and create referer-log / CSRF-style
 * leakage problems.
 *
 * What may ride there is a **stream ticket**: sixty seconds, this endpoint
 * only (`MessagingStreamTicketService`). A full access token in a URL put a
 * two-hour credential for the entire API into access logs, proxy logs and
 * browser history — anyone reading a log line owned the account.
 *
 * `?token=` still takes an access token, for clients built before the
 * ticket existed. It is deprecated and logged on every use: deploying this
 * API ahead of its frontends must not black out their message streams.
 * Once the deployed clients all send `?ticket=`, delete that branch — the
 * leak is only really closed when the URL can no longer carry a real
 * credential at all.
 *
 * Keeping this strategy in a separate file under the messaging module
 * makes the trade-off local and easy to reason about. The only thing
 * the FE may use a query-string token for is `GET /messaging/stream`.
 *
 * Naming: the strategy name is `'messaging-sse'` (not `'jwt-sse'`).
 * The longer name is deliberate — Passport registers strategies into a
 * single global registry, and we want it to be glaringly obvious in
 * grep / code review that any guard using this strategy ACCEPTS A
 * QUERY-STRING TOKEN. If you see `AuthGuard('messaging-sse')` outside
 * of the SSE controller, it is a security bug.
 *
 * Validation is intentionally simpler than the main JwtStrategy: we
 * accept any token whose signature checks out and whose subject
 * resolves to an active user. We do NOT consult the
 * password-changed-at marker here because expired-after-password-change
 * sessions are typically caught when the client first tries to call a
 * regular REST endpoint (which uses the main strategy); the stream
 * itself is read-only so even a slightly-late drop is acceptable.
 */
@Injectable()
export class SseJwtStrategy extends PassportStrategy(
  Strategy,
  'messaging-sse',
) {
  private readonly logger = new Logger(SseJwtStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not configured.');
    }
    super({
      // `?ticket=` is the supported way in. `?token=` is the deprecated
      // access-token path kept for already-deployed clients, and the
      // header stays for non-browser callers (curl / tests) that can set
      // one and have no reason to put anything in a URL.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromUrlQueryParameter('ticket'),
        ExtractJwt.fromUrlQueryParameter('token'),
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
      // So `validate` can see WHERE the token came from; the rules differ
      // per source and the payload alone cannot tell them apart.
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    const isTicket = payload.typ === TokenTypes.STREAM_TICKET;

    // A ticket is for the URL. Anywhere else it is a caller that could have
    // sent a real token and chose the weaker thing, so refuse it.
    if (isTicket && typeof req.query?.ticket !== 'string') {
      throw new UnauthorizedException();
    }

    // `?ticket=` means a ticket. Accepting an access token there too would
    // leave the leak open under a new parameter name.
    if (!isTicket && typeof req.query?.ticket === 'string') {
      throw new UnauthorizedException();
    }

    if (!isTicket && typeof req.query?.token === 'string') {
      this.logger.warn(
        'SSE stream opened with an access token in the query string. ' +
          'This is deprecated and leaks a full credential into access logs — ' +
          'the client should POST /messaging/stream/ticket and pass ?ticket=.',
      );
    }

    const user = await this.userService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }
    // Minimal shape — the SSE endpoint only needs req.user.id.
    return { id: user.id };
  }
}
