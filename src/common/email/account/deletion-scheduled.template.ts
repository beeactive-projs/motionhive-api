import { Locale, day } from '../../i18n';
import {
  baseLayout,
  calloutBox,
  eyebrow,
  heading,
  paragraph,
  plainTextLayout,
  primaryButton,
  securityNote,
} from '../_layouts/base-layout';
import { emailCopy } from '../_layouts/copy';

/**
 * Sent once the code is confirmed: the account is deactivated, what that
 * already ended, the date it will be erased, and how to keep it until then.
 */
export interface AccountDeletionScheduledParams {
  firstName: string | null;
  /** When the erasure runs. */
  scheduledFor: Date;
  signInLink: string;
  locale: Locale;
}

export function accountDeletionScheduledTemplate(
  params: AccountDeletionScheduledParams,
): string {
  const { firstName, scheduledFor, signInLink, locale } = params;
  const c = emailCopy(locale, 'email.account.deletionScheduled');
  const date = day(scheduledFor);

  const content = `
    ${eyebrow(c.html('eyebrow'), 'confirmation')}
    ${heading(c.html('heading'))}
    ${paragraph(c.html('body', { name: firstName, date }))}
    ${paragraph(c.html('woundDown'))}
    ${calloutBox('info', c.html('keep', { date }))}
    ${primaryButton(c.html('cta'), signInLink)}
    ${paragraph(c.html('retained'))}
    ${securityNote(c.html('help'))}
  `;

  return baseLayout(content, {
    preheader: c.html('preheader', { date }),
    category: 'confirmation',
    locale,
  });
}

export function accountDeletionScheduledTemplateText(
  params: AccountDeletionScheduledParams,
): string {
  const { firstName, scheduledFor, signInLink, locale } = params;
  const c = emailCopy(locale, 'email.account.deletionScheduled');
  const date = day(scheduledFor);
  return plainTextLayout({
    preheader: c.text('preheader', { date }),
    locale,
    sections: [
      {
        heading: c.text('heading'),
        body: [
          c.text('body', { name: firstName, date }),
          c.text('woundDown'),
          c.text('keep', { date }),
        ],
        ctas: [{ label: c.text('cta'), url: signInLink }],
      },
      { body: [c.text('retained'), c.text('help')] },
    ],
  });
}
