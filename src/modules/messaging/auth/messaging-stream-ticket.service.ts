import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenTypes } from '../../auth/types/jwt-payload';

/**
 * How long a stream ticket stands. Long enough to cover the round trip and
 * the `EventSource` handshake that follows it, short enough that a ticket
 * caught in an access log is worthless by the time anyone reads it.
 */
export const STREAM_TICKET_TTL_SECONDS = 60;

/**
 * Mints the short-lived ticket the SSE stream is opened with.
 *
 * `EventSource` cannot set request headers, so whatever authenticates the
 * stream has to ride in the URL — and a URL is the one place a credential
 * must never sit: it lands in access logs, proxy logs, browser history and
 * `Referer`. The access token used to go there directly, so a single log
 * line handed over a two-hour credential for the whole API.
 *
 * A ticket narrows both halves of that. It lives for a minute instead of two
 * hours, and it is refused everywhere except the stream — `JwtStrategy`
 * rejects it outright, so it cannot read a message, let alone send one.
 *
 * Deliberately stateless (a signed claim, not a stored nonce): single-use
 * would need shared state across instances, and buys little over a
 * sixty-second window on a read-only endpoint.
 */
@Injectable()
export class MessagingStreamTicketService {
  constructor(private readonly jwtService: JwtService) {}

  issue(userId: string): { ticket: string; expiresIn: number } {
    return {
      ticket: this.jwtService.sign(
        { sub: userId, typ: TokenTypes.STREAM_TICKET },
        { expiresIn: STREAM_TICKET_TTL_SECONDS },
      ),
      expiresIn: STREAM_TICKET_TTL_SECONDS,
    };
  }
}
