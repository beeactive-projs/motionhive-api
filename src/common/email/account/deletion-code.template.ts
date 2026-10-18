import { Locale } from '../../i18n';
import {
  baseLayout,
  codeBlock,
  eyebrow,
  expiryNote,
  heading,
  paragraph,
  plainTextLayout,
  secondaryButton,
  securityNote,
} from '../_layouts/base-layout';
import { emailCopy } from '../_layouts/copy';

/**
 * The 6-digit code that confirms an account deletion. Sent to the account's
 * own address, which is what proves the request comes from its owner, for
 * password and Google/Facebook accounts alike.
 *
 * Doubles as an alarm: if the person didn't ask, someone has their session
 * or their password, so the one button is "Change password".
 */
export interface AccountDeletionCodeParams {
  firstName: string | null;
  code: string;
  changePasswordLink: string;
  locale: Locale;
}

export function accountDeletionCodeTemplate(
  params: AccountDeletionCodeParams,
): string {
  const { firstName, code, changePasswordLink, locale } = params;
  const c = emailCopy(locale, 'email.account.deletionCode');

  const content = `
    ${eyebrow(c.html('eyebrow'), 'action')}
    ${heading(c.html('heading'))}
    ${paragraph(c.html('body', { name: firstName }))}
    ${codeBlock(code)}
    ${expiryNote(c.html('expiry'), locale)}
    ${paragraph(c.html('warning'))}
    ${secondaryButton(c.html('cta'), changePasswordLink)}
    ${securityNote(c.html('help'))}
  `;

  return baseLayout(content, {
    preheader: c.html('preheader'),
    category: 'action',
    locale,
  });
}

export function accountDeletionCodeTemplateText(
  params: AccountDeletionCodeParams,
): string {
  const { firstName, code, changePasswordLink, locale } = params;
  const c = emailCopy(locale, 'email.account.deletionCode');
  return plainTextLayout({
    preheader: c.text('preheader'),
    locale,
    sections: [
      {
        heading: c.text('heading'),
        body: [c.text('body', { name: firstName }), code, c.text('expiry')],
      },
      {
        body: [c.text('warning')],
        ctas: [{ label: c.text('cta'), url: changePasswordLink }],
      },
      { body: [c.text('help')] },
    ],
  });
}
