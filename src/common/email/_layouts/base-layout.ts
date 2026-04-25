/**
 * MotionHive email base layout + shared building blocks.
 *
 * Why this file exists:
 *   - Every transactional email shares the same outer shell (dark navy
 *     header with the MotionHive logo, white content area, dark footer
 *     with motionhive.fit link). Centralising it here means one place
 *     to update branding.
 *   - The `heading` / `paragraph` / `primaryButton` etc. helpers keep
 *     individual templates declarative and readable. They aren't a
 *     framework — just inline HTML strings tuned for email-client
 *     compatibility (Outlook MSO conditionals, table-based layout,
 *     `vertical-align`, no flex, etc.).
 *
 * Adding a new email? Drop a file under `src/common/email/<domain>/`
 * that imports `baseLayout` + the helpers it needs and exports a
 * single `<name>Template(...)` function. Templates MUST escape every
 * user-controlled string with `escapeHtml` from
 * `src/common/utils/html.utils.ts`.
 */

export const LOGO_URL =
  'https://res.cloudinary.com/dom4dfr1q/image/upload/v1774535916/motionhive-logo_jxsxic.png';

/**
 * Brand palette mirrored from the MotionHive UI. Keep in sync with
 * the FE Tailwind config when tokens change. Email clients can't read
 * CSS variables, so we inline these values into every template.
 */
export const COLORS = {
  bgDark: '#0f172a',
  bgDarker: '#0a1628',
  bgOuter: '#f4f4f5',
  bgCard: '#1e293b',
  accent: '#f59e0b',
  navyDefault: '#1E3A5F',
  accentHover: '#d97706',
  accentLight: '#fef3c7',
  highlightBg: '#fefce8',
  highlightText: '#92400e',
  highlightStrong: '#78350f',
  cardBg: '#f8fafc',
  cardBorder: '#e2e8f0',
  textWhite: '#ffffff',
  textLight: '#e2e8f0',
  textMuted: '#94a3b8',
  textMutedFooter: '#64748b',
  textDark: '#1e293b',
  textBody: '#27272a',
  textBodyAlt: '#334155',
  green: '#22c55e',
  greenBg: '#052e16',
  border: '#1e293b',
  contentBg: '#ffffff',
  footerBg: '#0f172a',
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Wraps email content in the branded base layout. `preheader` is the
 * snippet shown in inbox previews; `footerNote` overrides the default
 * © line for emails with a different unsubscribe context (e.g.
 * waitlist, feedback).
 */
export function baseLayout(
  content: string,
  preheader?: string,
  footerNote?: string,
): string {
  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>MotionHive</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
    img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
    body{margin:0;padding:0;width:100%!important;height:100%!important;background-color:${COLORS.bgOuter};}
    @media only screen and (max-width:600px){
      .email-container{width:100%!important;}
      .content-padding{padding:32px 24px!important;}
      .header-padding{padding:24px 24px!important;}
      .footer-padding{padding:24px 24px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.bgOuter};font-family:${FONT};">
  ${preheader ? `<div style="display:none;max-height:0px;overflow:hidden;mso-hide:all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:${COLORS.bgOuter};">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" class="email-container" style="max-width:560px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td class="header-padding" style="background-color:${COLORS.bgDark};padding:28px 40px;border-radius:12px 12px 0 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="font-size:0;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="width:50px;">
                          <img src="${LOGO_URL}" alt="MotionHive" width="50" style="display:block;width:50px;border-radius:6px;" />
                        </td>
                        <td style="padding-left:10px;font-size:18px;font-weight:700;color:${COLORS.textWhite};font-family:${FONT};letter-spacing:-0.3px;">
                          Motion<span style="color:${COLORS.accent};">Hive</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- AMBER ACCENT LINE -->
          <tr>
            <td style="background-color:${COLORS.accent};height:3px;font-size:1px;line-height:1px;">&nbsp;</td>
          </tr>

          <!-- CONTENT -->
          <tr>
            <td class="content-padding" style="background-color:${COLORS.contentBg};padding:44px 40px 40px 40px;">
              ${content}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="footer-padding" style="background-color:${COLORS.bgDark};padding:24px 40px;border-radius:0 0 12px 12px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="font-size:12px;line-height:1.5;color:${COLORS.textMutedFooter};font-family:${FONT};">
                    <a href="https://motionhive.fit" style="color:${COLORS.accent};text-decoration:none;font-weight:600;">motionhive.fit</a>
                  </td>
                </tr>
                <tr>
                  <td style="font-size:11px;line-height:1.5;color:#475569;font-family:${FONT};padding-top:8px;">
                    ${footerNote || `&copy; ${new Date().getFullYear()} MotionHive. All rights reserved.`}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

// =====================================================================
// SHARED CONTENT BLOCKS
// =====================================================================

export function primaryButton(text: string, href: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
      <tr>
        <td style="background-color:${COLORS.accent};border-radius:8px;">
          <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:${COLORS.navyDefault};text-decoration:none;border-radius:8px;background-color:${COLORS.accent};">
            ${text}
          </a>
        </td>
      </tr>
    </table>`;
}

export function heading(text: string): string {
  return `<h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:${COLORS.textDark};line-height:1.3;">${text}</h1>`;
}

export function subheading(text: string): string {
  return `<p style="margin:0 0 24px;font-size:15px;color:${COLORS.textMuted};line-height:1.5;">${text}</p>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:${COLORS.textBody};line-height:1.6;">${text}</p>`;
}

export function expiryNote(text: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
      <tr>
        <td style="background-color:#fef3c7;border-radius:8px;padding:12px 16px;border-left:4px solid ${COLORS.accent};">
          <p style="margin:0;font-size:13px;color:#92400e;">
            &#9202; ${text}
          </p>
        </td>
      </tr>
    </table>`;
}

export function divider(): string {
  return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">`;
}

export function securityNote(text: string): string {
  return `<p style="margin:16px 0 0;font-size:12px;color:${COLORS.textMuted};line-height:1.5;">${text}</p>`;
}

export function featureItem(icon: string, text: string): string {
  return `
    <tr>
      <td style="padding:6px 0;vertical-align:top;width:28px;">
        <span style="font-size:16px;">${icon}</span>
      </td>
      <td style="padding:6px 0 6px 8px;font-size:14px;color:${COLORS.textBody};line-height:1.5;">
        ${text}
      </td>
    </tr>`;
}
