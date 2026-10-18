import { Locale } from '../../i18n';
import {
  baseLayout,
  eyebrow,
  heading,
  paragraph,
  plainTextLayout,
  secondaryButton,
  securityNote,
} from '../_layouts/base-layout';
import { emailCopy } from '../_layouts/copy';

/**
 * Sent when someone signs in during the cooling-off and keeps the account.
 * Reassurance if it was them; the alert that lets them act if it wasn't.
 */
export interface AccountDeletionCancelledParams {
  firstName: string | null;
  changePasswordLink: string;
  locale: Locale;
}

export function accountDeletionCancelledTemplate(
  params: AccountDeletionCancelledParams,
): string {
  const { firstName, changePasswordLink, locale } = params;
  const c = emailCopy(locale, 'email.account.deletionCancelled');

  const content = `
    ${eyebrow(c.html('eyebrow'), 'update')}
    ${heading(c.html('heading'))}
    ${paragraph(c.html('body', { name: firstName }))}
    ${paragraph(c.html('warning'))}
    ${secondaryButton(c.html('cta'), changePasswordLink)}
    ${securityNote(c.html('help'))}
  `;

  return baseLayout(content, {
    preheader: c.html('preheader'),
    category: 'update',
    locale,
  });
}

export function accountDeletionCancelledTemplateText(
  params: AccountDeletionCancelledParams,
): string {
  const { firstName, changePasswordLink, locale } = params;
  const c = emailCopy(locale, 'email.account.deletionCancelled');
  return plainTextLayout({
    preheader: c.text('preheader'),
    locale,
    sections: [
      {
        heading: c.text('heading'),
        body: [c.text('body', { name: firstName }), c.text('warning')],
        ctas: [{ label: c.text('cta'), url: changePasswordLink }],
      },
      { body: [c.text('help')] },
    ],
  });
}
