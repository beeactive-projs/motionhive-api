import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import type { App } from 'firebase-admin/app';

import { DevicePlatform } from '../entities/device-token.entity';
import { PushMessage, PushResult, PushTransport } from './push-transport';

/** The name we register our Firebase app under, so we never clash with a default. */
const FIREBASE_APP_NAME = 'motionhive-push';

/**
 * Error codes meaning this token will never work again.
 *
 * Firebase reports a deleted app or a rotated token as
 * `registration-token-not-registered`, and a malformed one as
 * `invalid-registration-token`. Either way the row should be revoked
 * rather than retried.
 *
 * https://firebase.google.com/docs/cloud-messaging/send-message
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-recipient',
]);

/** Codes where repeating the identical request gets the identical answer. */
const PERMANENT_CODES = new Set([
  'messaging/invalid-argument',
  'messaging/invalid-payload',
  'messaging/authentication-error',
  'messaging/mismatched-credential',
]);

/**
 * Delivers a `PushMessage` to an Android phone over Firebase Cloud
 * Messaging.
 *
 * The counterpart to `ApnsTransport`, and the reason the push system
 * has a transport interface at all: this file is the only place that
 * knows anything about Google. The dispatcher picks between them on
 * `device_token.platform` and is otherwise identical for both.
 *
 * The Firebase SDK is loaded on first send, not at import. It opens a
 * socket as soon as it is required, which a deployment without a
 * Firebase project should never pay for — and which otherwise leaks a
 * handle into every test run that touches this file.
 *
 * Unconfigured is a normal state. Without the Firebase environment
 * variables `isConfigured()` is false and the dispatcher skips Android
 * devices, so iOS can ship and be tested long before a Firebase
 * project exists.
 */
@Injectable()
export class FcmTransport implements PushTransport {
  readonly platform = DevicePlatform.ANDROID;

  private readonly credentials: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  } | null;
  private app: App | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    // Service-account key contents, not a path — same reasoning as the
    // APNs key: Railway has no filesystem to keep a credential file on.
    const privateKey = this.config
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      this.credentials = null;
      this.logger.warn?.(
        'Firebase not configured — Android pushes will be skipped. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to enable.',
        'FcmTransport',
      );
      return;
    }

    this.credentials = { projectId, clientEmail, privateKey };
  }

  isConfigured(): boolean {
    return this.credentials !== null;
  }

  async send(token: string, message: PushMessage): Promise<PushResult> {
    const credentials = this.credentials;
    if (!credentials) {
      return {
        ok: false,
        reason: 'fcm_not_configured',
        retryable: false,
        tokenDead: false,
      };
    }

    try {
      const { cert, getApps, initializeApp } =
        await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');

      // Re-initialising the same named app throws, which would take the
      // process down on a hot reload in watch mode.
      this.app ??=
        getApps().find((a) => a.name === FIREBASE_APP_NAME) ??
        initializeApp({ credential: cert(credentials) }, FIREBASE_APP_NAME);

      await getMessaging(this.app).send({
        token,
        notification: { title: message.title, body: message.body },
        // FCM only carries string values here, which is why the
        // dispatcher hands us an already-flattened payload.
        data: message.data,
        android: {
          priority: 'high',
          // Groups related alerts so a newer one replaces an older one
          // about the same thing rather than stacking.
          collapseKey: message.collapseKey,
          notification: {
            // No `icon` or `color`: the app's manifest sets both
            // (default_notification_icon / _color), so the drawable name
            // lives with the drawable rather than in the server.
            sound: 'default',
            // collapseKey only decides which pending message survives
            // while the phone is offline. The tag is what replaces a
            // shown notification, as APNs' collapseId does on iOS.
            tag: message.collapseKey,
          },
        },
      });

      return { ok: true };
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'unknown';
      const reason =
        err instanceof Error ? `${code}: ${err.message}` : String(err);

      return {
        ok: false,
        reason: code === 'unknown' ? reason : code,
        retryable: !DEAD_TOKEN_CODES.has(code) && !PERMANENT_CODES.has(code),
        tokenDead: DEAD_TOKEN_CODES.has(code),
      };
    }
  }

  /**
   * Releases the Firebase app so a watch-mode reload can initialise a
   * fresh one, and so the process exits cleanly.
   */
  async onModuleDestroy(): Promise<void> {
    if (!this.app) return;
    const { deleteApp } = await import('firebase-admin/app');
    await deleteApp(this.app).catch(() => undefined);
    this.app = null;
  }
}
