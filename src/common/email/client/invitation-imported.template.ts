import type { Locale } from '../../i18n';
import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  calloutBox,
  eyebrow,
  expiryNote,
  heading,
  paragraph,
  personCard,
  plainTextLayout,
  primaryButton,
  securityNote,
} from '../_layouts/base-layout';
import { emailCopy } from '../_layouts/copy';

interface ClientInvitationImportedParams {
  /** The name the coach typed, or the account's own when there is one. */
  recipientFirstName: string | null;
  instructorName: string;
  instructorAvatarUrl: string | null;
  /** Signup link with the invite token, or the request inside the app. */
  link: string;
  /** Whether the reader already has an account. Picks the body and the button. */
  hasAccount: boolean;
  message?: string;
  locale: Locale;
}

/**
 * The invite a coach's imported client list sends. Same request and
 * token as a hand-typed invite (signup by token connects them on the
 * spot), worded for someone who already trains with the coach: greeted
 * by name, the coach's face first, and a line on why it arrived, since
 * the reader never asked for it.
 *
 * One button either way. Mail scanners open links, so accepting takes a
 * signed-in click inside the app, never a click in the email.
 */
export function clientInvitationImportedTemplate(
  params: ClientInvitationImportedParams,
): string {
  const {
    recipientFirstName,
    instructorName,
    instructorAvatarUrl,
    link,
    hasAccount,
    message,
    locale,
  } = params;
  const c = emailCopy(locale, 'email.client.invitationImported');
  const name = { name: instructorName };

  const content = `
    ${eyebrow(c.html('eyebrow'), 'action')}
    ${paragraph(c.html('greeting', { recipient: recipientFirstName || null }))}
    ${heading(c.html('heading', name))}
    ${personCard({
      name: escapeHtml(instructorName),
      role: c.html('personRole'),
      avatarUrl: instructorAvatarUrl ? escapeHtml(instructorAvatarUrl) : null,
    })}
    ${paragraph(c.html(hasAccount ? 'bodyExisting' : 'bodyNew', name))}
    ${message ? calloutBox('info', `<em>${c.html('messageQuote', { message })}</em>`) : ''}
    ${primaryButton(c.html(hasAccount ? 'ctaExisting' : 'ctaNew', name), link)}
    ${expiryNote(c.html('expiry'), locale)}
    ${securityNote(c.html('why', name))}
  `;

  return baseLayout(content, {
    preheader: c.html('preheader', name),
    category: 'action',
    locale,
  });
}

export function clientInvitationImportedTemplateText(
  params: ClientInvitationImportedParams,
): string {
  const {
    recipientFirstName,
    instructorName,
    link,
    hasAccount,
    message,
    locale,
  } = params;
  const c = emailCopy(locale, 'email.client.invitationImported');
  const name = { name: instructorName };

  return plainTextLayout({
    preheader: c.text('preheader', name),
    locale,
    sections: [
      {
        heading: c.text('heading', name),
        body: [
          c.text('greeting', { recipient: recipientFirstName || null }),
          c.text(hasAccount ? 'bodyExisting' : 'bodyNew', name),
          ...(message ? [c.text('messageLine', { message })] : []),
          c.text('expiry'),
        ],
        ctas: [
          {
            label: c.text(hasAccount ? 'ctaExisting' : 'ctaNew', name),
            url: link,
          },
        ],
      },
      { body: [c.text('why', name)] },
    ],
  });
}
