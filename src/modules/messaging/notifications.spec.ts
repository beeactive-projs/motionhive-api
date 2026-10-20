import { NotificationType } from '../notification/notification.service';
import { genericNotificationTemplate } from '../../common/email';
import { notificationText } from '../../../test/helpers/notification-text';
import { messageReceived } from './notifications';

describe('messaging notifications builder — Stage 6', () => {
  const base = {
    recipientId: 'recipient-id',
    conversationId: 'conv-id',
    senderName: 'Alice Smith',
    preview: 'See you at 5pm',
    suppressEmail: false,
    hidePreviewInEmail: false,
    muted: false,
  };

  it('builds a MESSAGE_RECEIVED NotifyParams with correct deep-link', () => {
    const p = messageReceived(base);
    expect(p.userId).toBe('recipient-id');
    expect(p.type).toBe(NotificationType.MESSAGE_RECEIVED);
    expect(p.data?.screen).toBe('messages');
    expect(p.data?.queryParams).toEqual({ conversationId: 'conv-id' });
    expect(notificationText(p).cta).toBe('Open conversation');
  });

  it('uses "Someone" when senderName is null', () => {
    const text = notificationText(
      messageReceived({ ...base, senderName: null }),
    );
    expect(text.title).toContain('Someone');
    expect(text.body).toContain('Someone');
  });

  it('says it in Romanian for a Romanian reader', () => {
    const p = messageReceived({ ...base, senderName: null });
    expect(notificationText(p, 'ro')).toMatchObject({
      title: 'Ai un mesaj nou',
      body: 'Mesaj nou: See you at 5pm',
      cta: 'Deschide conversația',
    });
  });

  it('truncates the preview to 80 chars with an ellipsis', () => {
    const long = 'x'.repeat(200);
    const text = notificationText(messageReceived({ ...base, preview: long }));
    // The preview portion (post "Alice Smith: ") has length 80 max.
    const previewPart = text.body.split(': ').slice(1).join(': ');
    expect(previewPart.length).toBe(80);
    expect(previewPart.endsWith('…')).toBe(true);
  });

  it('passes the name and preview raw; the email escapes them once', () => {
    const text = notificationText(
      messageReceived({
        ...base,
        senderName: 'Alice <script>',
        preview: 'try <img src=x onerror=alert(1)> & win',
      }),
    );
    // Raw here: the app binds this as text and a push is plain text, so
    // an entity would be shown to the reader literally.
    expect(text.body).toBe(
      'Alice <script>: try <img src=x onerror=alert(1)> & win',
    );

    const html = genericNotificationTemplate({ ...text, locale: 'en' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Alice &lt;script&gt;');
    // Escaped once, not twice.
    expect(html).toContain('&amp; win');
    expect(html).not.toContain('&amp;amp;');
  });

  it('omits the preview when hidePreviewInEmail=true', () => {
    const text = notificationText(
      messageReceived({ ...base, hidePreviewInEmail: true }),
    );
    expect(text.body).not.toContain('See you at 5pm');
    expect(text.body).toContain('sent you a new message');
  });

  it('always suppresses in_app; turns email off when suppressEmail=true', () => {
    // First-in-window: in_app stays off (bell would duplicate the
    // sidebar Messages badge), email goes through.
    expect(
      messageReceived({ ...base, suppressEmail: false }).channelOverride,
    ).toEqual({ in_app: false, email: true });

    // After the hour-window cap fires: both channels off, the recipient
    // already has the live unread indicator on the sidebar + the
    // earlier email for that conversation.
    expect(
      messageReceived({ ...base, suppressEmail: true }).channelOverride,
    ).toEqual({ in_app: false, email: false });
  });

  it('leaves push to the preference, and turns it off for a muted conversation', () => {
    // Not in the override at all, so a user who switched message push
    // off in their settings stays off.
    expect(messageReceived(base).channelOverride).not.toHaveProperty('push');
    expect(messageReceived({ ...base, muted: true }).channelOverride).toEqual({
      in_app: false,
      email: true,
      push: false,
    });
  });

  it('groups pushes by conversation without deduplicating them', () => {
    const p = messageReceived(base);
    expect(p.collapseKey).toBe('conversation.conv-id');
    // A fingerprint would swallow the second message in the thread.
    expect(p.fingerprint).toBeUndefined();
  });
});
