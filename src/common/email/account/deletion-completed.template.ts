import { Locale } from '../../i18n';
import {
  baseLayout,
  eyebrow,
  heading,
  paragraph,
  plainTextLayout,
  securityNote,
} from '../_layouts/base-layout';
import { emailCopy } from '../_layouts/copy';

/**
 * The last email: the erasure ran. Sent to the address the account had,
 * captured before it was scrubbed. The published policy promises this
 * confirmation and names what is kept and for how long.
 */
export interface AccountDeletionCompletedParams {
  firstName: string | null;
  locale: Locale;
}

export function accountDeletionCompletedTemplate(
  params: AccountDeletionCompletedParams,
): string {
  const { firstName, locale } = params;
  const c = emailCopy(locale, 'email.account.deletionCompleted');

  const content = `
    ${eyebrow(c.html('eyebrow'), 'confirmation')}
    ${heading(c.html('heading'))}
    ${paragraph(c.html('body', { name: firstName }))}
    ${paragraph(c.html('retained'))}
    ${paragraph(c.html('backups'))}
    ${securityNote(c.html('help'))}
  `;

  return baseLayout(content, {
    preheader: c.html('preheader'),
    category: 'confirmation',
    locale,
  });
}

export function accountDeletionCompletedTemplateText(
  params: AccountDeletionCompletedParams,
): string {
  const { firstName, locale } = params;
  const c = emailCopy(locale, 'email.account.deletionCompleted');
  return plainTextLayout({
    preheader: c.text('preheader'),
    locale,
    sections: [
      {
        heading: c.text('heading'),
        body: [
          c.text('body', { name: firstName }),
          c.text('retained'),
          c.text('backups'),
        ],
      },
      { body: [c.text('help')] },
    ],
  });
}
