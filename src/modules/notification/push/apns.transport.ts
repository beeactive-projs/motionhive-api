import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { Provider } from '@parse/node-apn';

import { DevicePlatform } from '../entities/device-token.entity';
import { PushMessage, PushResult, PushTransport } from './push-transport';

/**
 * Reasons Apple gives when a token will never work again. Anything
 * else is treated as transient and retried.
 *
 * `Unregistered` means the app was deleted or the token replaced;
 * `BadDeviceToken` means it was never valid for this environment,
 * which in practice is almost always a sandbox token sent to
 * production or the reverse. Both should revoke the row rather than
 * burn the retry budget.
 *
 * https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
 */
const DEAD_TOKEN_REASONS = new Set([
  'BadDeviceToken',
  'Unregistered',
  'DeviceTokenNotForTopic',
]);

interface ApnsCredentials {
  key: string;
  keyId: string;
  teamId: string;
  topic: string;
  production: boolean;
}

/**
 * Delivers a `PushMessage` to an iPhone over Apple Push Notification
 * service, signed with a `.p8` key.
 *
 * Talks to Apple directly rather than relaying through Firebase. For an
 * iOS rollout Firebase would add a second vendor, an extra pod, a plist
 * and startup code in the AppDelegate, all to forward a message to the
 * service we can reach ourselves. Android has its own transport beside
 * this one; nothing above the `PushTransport` boundary knows which is
 * which.
 *
 * The Apple SDK is loaded on first send, not at import. It opens a
 * socket as soon as it is required, which a deployment without APNs
 * credentials should never pay for — and which otherwise leaks a
 * handle into every test run that touches this file.
 *
 * Unconfigured is a normal state, not an error. Without the APNs
 * environment variables `isConfigured()` is false and the dispatcher
 * skips iOS devices, the same posture as running without Redis.
 */
@Injectable()
export class ApnsTransport implements PushTransport, OnModuleDestroy {
  readonly platform = DevicePlatform.IOS;

  private readonly credentials: ApnsCredentials | null;
  private provider: Provider | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    const keyId = this.config.get<string>('APNS_KEY_ID');
    const teamId = this.config.get<string>('APNS_TEAM_ID');
    const topic = this.config.get<string>('APNS_BUNDLE_ID');
    // The .p8 contents, not a path. Railway has no filesystem to put a
    // key file on, and a path would differ per environment; the literal
    // newlines are escaped in the variable and restored here.
    const key = this.config
      .get<string>('APNS_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!keyId || !teamId || !topic || !key) {
      this.credentials = null;
      this.logger.warn?.(
        'APNs not configured — iOS pushes will be skipped. Set APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID and APNS_PRIVATE_KEY to enable.',
        'ApnsTransport',
      );
      return;
    }

    this.credentials = {
      key,
      keyId,
      teamId,
      topic,
      // Sandbox and production are different APNs hosts AND different
      // token namespaces: a token minted by a development build is
      // rejected by the production host. Sandbox is only for builds run
      // from Xcode; TestFlight and App Store builds register with
      // production, so any API they talk to needs APNS_PRODUCTION=true.
      production: this.config.get<string>('APNS_PRODUCTION') === 'true',
    };
  }

  isConfigured(): boolean {
    return this.credentials !== null;
  }

  async send(token: string, message: PushMessage): Promise<PushResult> {
    const credentials = this.credentials;
    if (!credentials) {
      return {
        ok: false,
        reason: 'apns_not_configured',
        retryable: false,
        tokenDead: false,
      };
    }

    try {
      const apn = await import('@parse/node-apn');
      this.provider ??= new apn.Provider({
        token: {
          key: credentials.key,
          keyId: credentials.keyId,
          teamId: credentials.teamId,
        },
        production: credentials.production,
      });

      const notification = new apn.Notification();
      notification.topic = credentials.topic;
      notification.alert = { title: message.title, body: message.body };
      notification.sound = 'default';
      // Alerts the user sees, as opposed to a silent content update.
      // Apple rejects the request outright without this header.
      notification.pushType = 'alert';
      if (message.badge !== undefined) notification.badge = message.badge;
      if (message.collapseKey) notification.collapseId = message.collapseKey;
      // Everything the app needs to route the tap rides in the custom
      // payload; the app reads it from the notification's extra data.
      if (message.data) notification.payload = { ...message.data };

      const response = await this.provider.send(notification, token);

      if (response.sent.length > 0) return { ok: true };

      const failure = response.failed[0];
      const reason =
        failure?.response?.reason ?? failure?.error?.message ?? 'unknown';
      const status = failure?.status ? Number(failure.status) : undefined;

      return {
        ok: false,
        reason,
        // 4xx is Apple telling us the request is wrong; repeating it
        // unchanged gets the same answer. 5xx and throttling are worth
        // another attempt.
        retryable: status === undefined || status >= 500 || status === 429,
        tokenDead: DEAD_TOKEN_REASONS.has(reason) || status === 410,
      };
    } catch (err) {
      // A throw here is the connection or the credentials failing, not
      // Apple rejecting the message, so it is worth retrying.
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        retryable: true,
        tokenDead: false,
      };
    }
  }

  onModuleDestroy(): void {
    // The provider holds an HTTP/2 connection open; without this the
    // process will not exit cleanly on shutdown.
    this.provider?.shutdown();
    this.provider = null;
  }
}
