/**
 * MotionHive email base layout + shared building blocks.
 *
 * Why this file exists:
 *   - Every transactional email shares the same outer shell: navy
 *     header with the MotionHive hex-icon + Poppins wordmark, a
 *     white content area, an optional honeycomb hero band for
 *     attention-grabbing emails, and a dark footer carrying the
 *     trader identity + policy links (see `COMPANY` / `LEGAL_URLS`).
 *   - The helpers (`heading`, `paragraph`, `primaryButton`,
 *     `calloutBox`, `dataRow`, `personCard`, `dateTimeBlock`,
 *     `eyebrow`, `chip`, …) keep individual templates declarative.
 *     They aren't a framework — just inline-style HTML strings tuned
 *     for email-client compatibility (Outlook MSO conditionals,
 *     table-based layout, no flex, no grid).
 *
 * Five email categories drive visual treatment via a single
 * `category` token. Each template declares which one it is; the
 * shell paints the accent line and the heroBand from that, and the
 * template calls `eyebrow(text, category)` to render the matching
 * chip. See `CATEGORY_RULES` below for the assignments.
 *
 * Adding a new email? Drop a file under `src/common/email/<domain>/`
 * that imports `baseLayout` + the helpers it needs and exports a
 * single `<name>Template(...)` function. Templates MUST escape every
 * user-controlled string with `escapeHtml` from
 * `src/common/utils/html.utils.ts`.
 */

// ─────────────────────────────────────────────────────────────────────
// LOGO
// ─────────────────────────────────────────────────────────────────────

/**
 * Hosted PNG of the honey hex icon. Email clients (especially
 * Outlook + Gmail webmail) cannot render SVG reliably, so we serve
 * a transparent PNG. Update this URL when the brand updates the
 * uploaded asset; do NOT inline SVG.
 */
export const LOGO_URL =
  'https://res.cloudinary.com/dom4dfr1q/image/upload/v1778503491/logo-bg-navy-sm_1_ac6drj.png';

// ─────────────────────────────────────────────────────────────────────
// LEGAL IDENTITY
// ─────────────────────────────────────────────────────────────────────

/** Marketing site root. Legal pages and the footer brand link hang off it. */
export const WEBSITE_URL = 'https://motionhive.fit';

/**
 * Trader identity printed in every email footer.
 *
 * Kept in sync with the legal documents on the marketing site
 * (`projects/website/src/app/legal/*` in the UI repo) — the cookie
 * policy, privacy notice and terms all state the same entity. Change
 * these only alongside those pages; a mismatch between what the email
 * claims and what the published policy says is the problem this block
 * exists to avoid.
 */
export const COMPANY = {
  legalName: 'HIVECRAFT S.R.L.',
  tradingName: 'MotionHive',
  address:
    'Soporului nr. 8C, bl. C, sc. 2, et. 1, ap. 58, Cluj-Napoca, Cluj 400482, Romania',
  contactEmail: 'contact@motionhive.fit',
};

/** Canonical legal-document URLs, linked from the footer of every email. */
export const LEGAL_URLS = {
  terms: `${WEBSITE_URL}/legal/terms-of-service`,
  privacy: `${WEBSITE_URL}/legal/privacy-policy`,
  cookies: `${WEBSITE_URL}/legal/cookie-policy`,
};

// ─────────────────────────────────────────────────────────────────────
// COLOR TOKENS
// ─────────────────────────────────────────────────────────────────────

/**
 * MotionHive brand palette for email. Mirrors the FE Tailwind config
 * but inlined here because email clients can't read CSS variables.
 *
 * Naming follows the brand spec:
 *   honey*   — primary brand (CTAs, system / payments / positive)
 *   coral*   — people accent (community, mentions, requests)
 *   teal*    — schedule accent (sessions, time-based actions)
 *   navy / ink — text + dark UI
 *   surface  — cream backgrounds
 *   line     — borders
 *
 * Older keys (accent, accentHover, cardBg, textBody, …) are kept as
 * deprecated aliases so the existing 19 templates keep compiling
 * unchanged. New templates MUST use the namespaced keys.
 */
export const COLORS = {
  // ── Honey (primary brand) ─────────────────────────────────────────
  honey: '#f59e0b',
  honeyDeep: '#d97706',
  honey800: '#92400e',
  honey100: '#fef3c7',
  honey50: '#fffbeb',

  // ── Coral (people / social) ───────────────────────────────────────
  coral500: '#f97066',
  coral700: '#c4392f',
  coral100: '#ffe4dc',
  coral50: '#fff5f1',

  // ── Teal (schedule / time) ────────────────────────────────────────
  teal500: '#14b8a6',
  teal700: '#0f766e',
  teal100: '#ccfbf1',
  teal50: '#f0fdfa',

  // ── Navy / Ink (text, dark UI) ────────────────────────────────────
  // navy / navy900 are tuned to the logo PNG's square background
  // (#0e1b31) so the header chrome blends seamlessly with the logo
  // image — no visible seam between the navy square around the hex
  // icon and the navy email header.
  navy: '#0e1b31',
  navy900: '#0e1b31',
  navy800: '#1e293b',
  ink2: '#475569',
  ink3: '#94a3b8',
  /**
   * Footer link text on navy. ink2 fails contrast against navy900
   * (~2.2:1); this clears 10:1 while still sitting behind the honey
   * brand link in the visual hierarchy.
   */
  footerLink: '#cbd5e1',

  // ── Surfaces ──────────────────────────────────────────────────────
  surface50: '#fcfaf6',
  surface100: '#f7f1e6',
  white: '#ffffff',

  // ── Lines ─────────────────────────────────────────────────────────
  line: 'rgba(15,23,42,0.08)',
  lineSolid: '#e6e2da',

  // ── Semantic (status / callouts) ──────────────────────────────────
  successFg: '#0f766e',
  successBg: '#ccfbf1',
  warningFg: '#92400e',
  warningBg: '#fef3c7',
  errorFg: '#991b1b',
  errorBg: '#fee2e2',
  infoFg: '#1e293b',
  infoBg: '#f1f5f9',

  // ─── DEPRECATED ALIASES — DO NOT USE IN NEW TEMPLATES ────────────
  // Kept so the 19 existing templates compile. Remove only after
  // every template has been migrated to the namespaced keys above.
  /** @deprecated use COLORS.navy900 */
  bgDark: '#0e1b31',
  /** @deprecated use COLORS.navy900 */
  bgDarker: '#0a1628',
  /** @deprecated use COLORS.surface50 */
  bgOuter: '#fcfaf6',
  /** @deprecated use COLORS.navy800 */
  bgCard: '#1e293b',
  /** @deprecated use COLORS.honey */
  accent: '#f59e0b',
  /** @deprecated MotionHive uses navy text on honey CTAs */
  navyDefault: '#0e1b31',
  /** @deprecated use COLORS.honeyDeep */
  accentHover: '#d97706',
  /** @deprecated use COLORS.honey100 */
  accentLight: '#fef3c7',
  /** @deprecated use COLORS.honey50 */
  highlightBg: '#fffbeb',
  /** @deprecated use COLORS.honey800 */
  highlightText: '#92400e',
  /** @deprecated use COLORS.honey800 */
  highlightStrong: '#92400e',
  /** @deprecated use COLORS.surface100 */
  cardBg: '#f7f1e6',
  /** @deprecated use COLORS.lineSolid */
  cardBorder: '#e6e2da',
  /** @deprecated use COLORS.white */
  textWhite: '#ffffff',
  /** @deprecated use COLORS.surface100 */
  textLight: '#f7f1e6',
  /** @deprecated use COLORS.ink3 */
  textMuted: '#94a3b8',
  /** @deprecated use COLORS.ink2 */
  textMutedFooter: '#475569',
  /** @deprecated use COLORS.navy900 */
  textDark: '#0e1b31',
  /** @deprecated use COLORS.navy900 */
  textBody: '#0e1b31',
  /** @deprecated use COLORS.ink2 */
  textBodyAlt: '#475569',
  /** @deprecated use COLORS.successFg */
  green: '#0f766e',
  /** @deprecated use COLORS.successBg */
  greenBg: '#ccfbf1',
  /** @deprecated use COLORS.lineSolid */
  border: '#e6e2da',
  /** @deprecated use COLORS.white */
  contentBg: '#ffffff',
  /** @deprecated use COLORS.navy900 */
  footerBg: '#0e1b31',
};

// ─────────────────────────────────────────────────────────────────────
// FONT STACKS
// ─────────────────────────────────────────────────────────────────────

/**
 * Body / UI stack. Inter is the brand body font; we degrade gracefully
 * because no email client guarantees web-font loading.
 */
const FONT_BODY = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * Display / heading stack. Poppins for headings, brand voice, and
 * eyebrow chips. Same fallback chain as body.
 */
const FONT_DISPLAY = "Poppins, 'Helvetica Neue', Helvetica, Arial, sans-serif";

// ─────────────────────────────────────────────────────────────────────
// CATEGORY SYSTEM
// ─────────────────────────────────────────────────────────────────────

/**
 * Five email categories, each with a distinct visual treatment.
 *
 *   action       — User must click to proceed. Honey accent. Hero band.
 *   confirmation — Something they did succeeded. Teal accent.
 *   update       — Neutral FYI. Ink-2 accent.
 *   time         — Schedule-framed (reminder / cancelled). Teal accent. Hero band.
 *   request      — Someone wants something from them. Coral accent.
 */
export type EmailCategory =
  | 'action'
  | 'confirmation'
  | 'update'
  | 'time'
  | 'request';

interface CategoryStyle {
  /** Eyebrow chip background. */
  chipBg: string;
  /** Eyebrow chip text. */
  chipFg: string;
  /** 3px accent rule under the header. */
  rule: string;
  /** Default eyebrow label (templates can override). */
  defaultLabel: string;
  /** Whether the heroBand renders by default. */
  defaultHeroBand: boolean;
}

const CATEGORY_STYLES: Record<EmailCategory, CategoryStyle> = {
  action: {
    chipBg: COLORS.honey100,
    chipFg: COLORS.honey800,
    rule: COLORS.honey,
    defaultLabel: 'ACTION REQUIRED',
    defaultHeroBand: true,
  },
  confirmation: {
    chipBg: COLORS.teal100,
    chipFg: COLORS.teal700,
    rule: COLORS.teal500,
    defaultLabel: 'CONFIRMED',
    defaultHeroBand: false,
  },
  update: {
    chipBg: '#e2e8f0',
    chipFg: COLORS.ink2,
    rule: COLORS.ink2,
    defaultLabel: 'UPDATE',
    defaultHeroBand: false,
  },
  time: {
    chipBg: COLORS.teal100,
    chipFg: COLORS.teal700,
    rule: COLORS.teal500,
    defaultLabel: 'REMINDER',
    defaultHeroBand: true,
  },
  request: {
    chipBg: COLORS.coral100,
    chipFg: COLORS.coral700,
    rule: COLORS.coral500,
    defaultLabel: 'REQUEST',
    defaultHeroBand: false,
  },
};

// ─────────────────────────────────────────────────────────────────────
// BASELAYOUT — overloaded for back-compat
// ─────────────────────────────────────────────────────────────────────

export interface BaseLayoutOptions {
  /** Snippet shown in inbox previews. */
  preheader?: string;
  /**
   * "Why am I getting this?" line, shown above the legal block.
   *
   * This used to double as the copyright line, so any template that
   * set it silently dropped the copyright. It is now purely additive:
   * the legal block (copyright, trader identity, policy links)
   * renders on every email regardless.
   */
  footerNote?: string;
  /**
   * Category controls the accent line + heroBand. Templates SHOULD
   * pass this; defaults to 'update' for back-compat with old callers
   * that never declared one.
   */
  category?: EmailCategory;
  /**
   * Force the hero band on/off. When undefined, the category's
   * `defaultHeroBand` decides. Pass `false` on an action-category
   * email to skip the band; pass `true` on confirmation to add one.
   */
  heroBand?: boolean;
}

/**
 * Wraps email content in the branded base layout.
 *
 * **Two call shapes** — the legacy positional form is preserved so
 * the existing 19 templates compile unchanged. New templates SHOULD
 * use the options-object form so they can declare a category.
 *
 * ```ts
 * // Legacy (still works):
 * baseLayout(content, 'preheader', 'footer note');
 *
 * // New form:
 * baseLayout(content, {
 *   preheader: 'Verify your email to get started',
 *   category: 'action',
 *   heroBand: true,
 * });
 * ```
 */
export function baseLayout(
  content: string,
  preheaderOrOptions?: string | BaseLayoutOptions,
  footerNote?: string,
): string {
  const opts: BaseLayoutOptions =
    typeof preheaderOrOptions === 'object' && preheaderOrOptions !== null
      ? preheaderOrOptions
      : { preheader: preheaderOrOptions, footerNote };

  const category: EmailCategory = opts.category ?? 'update';
  const style = CATEGORY_STYLES[category];
  const showHeroBand = opts.heroBand ?? style.defaultHeroBand;
  const preheader = opts.preheader;
  const reasonNote = opts.footerNote;

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
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
    body{margin:0;padding:0;width:100%!important;height:100%!important;background-color:${COLORS.surface50};}
    a{color:${COLORS.honeyDeep};}
    @media only screen and (max-width:600px){
      .email-container{width:100%!important;}
      .content-padding{padding:32px 22px!important;}
      .header-padding{padding:22px 22px!important;}
      .footer-padding{padding:22px 22px!important;}
      .hero-padding{padding:18px 22px!important;}
      .stack-row > td{display:block!important;width:100%!important;padding-left:0!important;padding-top:12px!important;}
      .btn-stack{width:100%!important;}
      .btn-stack a{display:block!important;}
    }
    /* Apple Mail / iOS dark mode — no Outlook hacks. Honey + Coral
       stay vivid; navy surfaces flip to a darker navy; white card
       surface flips to navy-800; text inverts to surface-50. */
    @media (prefers-color-scheme: dark) {
      .mh-shell{background-color:#020617!important;}
      .mh-card{background-color:${COLORS.navy800}!important;}
      .mh-text-body{color:#e2e8f0!important;}
      .mh-text-heading{color:#ffffff!important;}
      .mh-text-muted{color:#94a3b8!important;}
      .mh-line{border-color:#334155!important;}
      .mh-callout-info{background-color:#1e293b!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.surface50};font-family:${FONT_BODY};" class="mh-shell">
  ${preheader ? `<div style="display:none;max-height:0px;overflow:hidden;mso-hide:all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:${COLORS.surface50};">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container" style="max-width:600px;width:100%;">

          <!-- HEADER ────────────────────────────────────────────── -->
          <tr>
            <td class="header-padding" style="background-color:${COLORS.navy900};padding:24px 36px;border-radius:16px 16px 0 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="${LOGO_URL}" alt="" width="36" height="36" style="display:block;width:36px;height:36px;border:0;" />
                  </td>
                  <td style="padding-left:12px;vertical-align:middle;font-family:${FONT_DISPLAY};font-size:20px;font-weight:600;color:${COLORS.white};letter-spacing:-0.01em;">
                    MotionHive
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CATEGORY ACCENT RULE ────────────────────────────────── -->
          <tr>
            <td style="background-color:${style.rule};height:3px;font-size:1px;line-height:1px;">&nbsp;</td>
          </tr>

          ${
            showHeroBand
              ? `<!-- HONEYCOMB HERO BAND ───────────────────────────── -->
          <tr>
            <td class="hero-padding" style="background-color:${COLORS.honey50};background-image:${HONEYCOMB_DATA_URI};background-repeat:repeat;background-position:center;padding:14px 36px;font-size:1px;line-height:1px;height:18px;border-bottom:1px solid ${COLORS.line};">&nbsp;</td>
          </tr>`
              : ''
          }

          <!-- CONTENT ─────────────────────────────────────────────── -->
          <tr>
            <td class="content-padding mh-card" style="background-color:${COLORS.white};padding:40px 36px 36px 36px;font-family:${FONT_BODY};">
              ${content}
            </td>
          </tr>

          <!-- FOOTER ──────────────────────────────────────────────── -->
          <tr>
            <td class="footer-padding" style="background-color:${COLORS.navy900};padding:22px 36px 24px 36px;border-radius:0 0 16px 16px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="font-family:${FONT_DISPLAY};font-size:13px;line-height:1.5;color:${COLORS.white};font-weight:600;letter-spacing:-0.01em;">
                    <a href="${WEBSITE_URL}" style="color:${COLORS.honey};text-decoration:none;">motionhive.fit</a>
                  </td>
                </tr>
                <tr>
                  <td style="font-family:${FONT_BODY};font-size:11px;line-height:1.9;color:${COLORS.ink3};padding-top:8px;">
                    <a href="${LEGAL_URLS.terms}" style="color:${COLORS.footerLink};text-decoration:none;">Terms of Service</a>
                    &nbsp;&middot;&nbsp;
                    <a href="${LEGAL_URLS.privacy}" style="color:${COLORS.footerLink};text-decoration:none;">Privacy Policy</a>
                    &nbsp;&middot;&nbsp;
                    <a href="${LEGAL_URLS.cookies}" style="color:${COLORS.footerLink};text-decoration:none;">Cookie Policy</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:14px;border-top:1px solid rgba(255,255,255,0.10);font-size:1px;line-height:1px;">&nbsp;</td>
                </tr>
                ${
                  reasonNote
                    ? `<tr>
                  <td style="font-family:${FONT_BODY};font-size:11px;line-height:1.6;color:${COLORS.ink3};padding-bottom:8px;">
                    ${reasonNote}
                  </td>
                </tr>`
                    : ''
                }
                <tr>
                  <td style="font-family:${FONT_BODY};font-size:11px;line-height:1.6;color:${COLORS.ink3};">
                    ${COMPANY.legalName} (${COMPANY.tradingName}) &middot; ${COMPANY.address}
                  </td>
                </tr>
                <tr>
                  <td style="font-family:${FONT_BODY};font-size:11px;line-height:1.6;color:${COLORS.ink3};padding-top:4px;">
                    <a href="mailto:${COMPANY.contactEmail}" style="color:${COLORS.footerLink};text-decoration:none;">${COMPANY.contactEmail}</a>
                    &nbsp;&middot;&nbsp;
                    &copy; ${new Date().getFullYear()} ${COMPANY.tradingName}. All rights reserved.
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

// ─────────────────────────────────────────────────────────────────────
// CONTENT BLOCKS
// ─────────────────────────────────────────────────────────────────────

/**
 * Eyebrow chip — small uppercase label above the heading. Pairs the
 * email with its category so the user understands intent before
 * reading the body.
 */
export function eyebrow(
  text: string,
  category: EmailCategory = 'update',
): string {
  const s = CATEGORY_STYLES[category];
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr>
        <td style="background-color:${s.chipBg};border-radius:999px;padding:5px 12px;font-family:${FONT_DISPLAY};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${s.chipFg};line-height:1.2;">
          ${text || s.defaultLabel}
        </td>
      </tr>
    </table>`;
}

export function heading(text: string): string {
  return `<h1 class="mh-text-heading" style="margin:0 0 10px;font-family:${FONT_DISPLAY};font-size:28px;font-weight:600;color:${COLORS.navy900};line-height:1.2;letter-spacing:-0.02em;">${text}</h1>`;
}

export function subheading(text: string): string {
  return `<p class="mh-text-muted" style="margin:0 0 24px;font-family:${FONT_BODY};font-size:15px;color:${COLORS.ink2};line-height:1.55;">${text}</p>`;
}

export function paragraph(text: string): string {
  return `<p class="mh-text-body" style="margin:0 0 16px;font-family:${FONT_BODY};font-size:15px;color:${COLORS.navy900};line-height:1.65;">${text}</p>`;
}

/**
 * Primary CTA — honey fill, navy text, pill shape. Bulletproof
 * table-based button so Outlook renders the rounded edge correctly.
 */
export function primaryButton(text: string, href: string): string {
  return buttonShell(text, href, {
    bg: COLORS.honey,
    fg: COLORS.navy900,
    border: COLORS.honey,
  });
}

/**
 * Secondary CTA — outline pill, navy text, line border. Use as the
 * sibling action when there is also a primary (e.g. "Open MotionHive"
 * after a confirmation).
 */
export function secondaryButton(text: string, href: string): string {
  return buttonShell(text, href, {
    bg: COLORS.white,
    fg: COLORS.navy900,
    border: COLORS.lineSolid,
  });
}

/**
 * Destructive CTA — coral text on white with a coral border. Reserved
 * for irreversible actions; in transactional email this is rarely the
 * primary action, more often a "Decline" sibling.
 */
export function dangerButton(text: string, href: string): string {
  return buttonShell(text, href, {
    bg: COLORS.white,
    fg: COLORS.coral700,
    border: COLORS.coral500,
  });
}

interface ButtonStyle {
  bg: string;
  fg: string;
  border: string;
}

function buttonShell(text: string, href: string, s: ButtonStyle): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
      <tr>
        <td style="background-color:${s.bg};border-radius:999px;border:1px solid ${s.border};">
          <a href="${href}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT_DISPLAY};font-size:15px;font-weight:600;color:${s.fg};text-decoration:none;border-radius:999px;letter-spacing:-0.01em;">
            ${text}
          </a>
        </td>
      </tr>
    </table>`;
}

/**
 * Renders two pill buttons side-by-side (with mobile stacking via
 * the `.btn-stack` media query). Use for accept/decline pairs in
 * Incoming Request emails.
 */
export function buttonRow(buttons: string[]): string {
  const cells = buttons
    .map(
      (b, i) =>
        `<td class="btn-stack" style="vertical-align:top;${i > 0 ? 'padding-left:10px;' : ''}">${b}</td>`,
    )
    .join('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;">
      <tr class="stack-row">${cells}</tr>
    </table>`;
}

/**
 * Soft pill chip. Use for inline labels (status, role, plan name)
 * inside cards and dataRows.
 */
export type ChipTone = 'honey' | 'coral' | 'teal' | 'neutral';

export function chip(text: string, tone: ChipTone = 'honey'): string {
  const tones: Record<ChipTone, { bg: string; fg: string }> = {
    honey: { bg: COLORS.honey100, fg: COLORS.honey800 },
    coral: { bg: COLORS.coral100, fg: COLORS.coral700 },
    teal: { bg: COLORS.teal100, fg: COLORS.teal700 },
    neutral: { bg: '#e2e8f0', fg: COLORS.ink2 },
  };
  const t = tones[tone];
  return `<span style="display:inline-block;background-color:${t.bg};color:${t.fg};border-radius:999px;padding:3px 10px;font-family:${FONT_DISPLAY};font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;line-height:1.4;">${text}</span>`;
}

/**
 * Callout box for inline notices that aren't the headline. Four
 * tones (info / success / warning / error) — pick the one that
 * matches the SEMANTIC, not the brand color.
 */
export type CalloutKind = 'info' | 'success' | 'warning' | 'error';

export function calloutBox(kind: CalloutKind, text: string): string {
  const map: Record<CalloutKind, { bg: string; fg: string; rule: string }> = {
    info: { bg: COLORS.infoBg, fg: COLORS.navy900, rule: COLORS.ink2 },
    success: {
      bg: COLORS.successBg,
      fg: COLORS.successFg,
      rule: COLORS.teal500,
    },
    warning: { bg: COLORS.warningBg, fg: COLORS.warningFg, rule: COLORS.honey },
    error: { bg: COLORS.errorBg, fg: COLORS.errorFg, rule: '#ef4444' },
  };
  const s = map[kind];
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;" class="mh-callout-info">
      <tr>
        <td style="background-color:${s.bg};border-radius:12px;padding:14px 18px;border-left:3px solid ${s.rule};">
          <p style="margin:0;font-family:${FONT_BODY};font-size:14px;color:${s.fg};line-height:1.55;">${text}</p>
        </td>
      </tr>
    </table>`;
}

/**
 * Single label/value row for invoice + session detail blocks. Stack
 * several inside a `dataCard()` for a list. Label is muted-uppercase,
 * value is body-strength.
 */
export function dataRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${COLORS.lineSolid};font-family:${FONT_BODY};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr class="stack-row">
            <td style="width:40%;font-family:${FONT_DISPLAY};font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${COLORS.ink3};vertical-align:top;">${label}</td>
            <td style="font-family:${FONT_BODY};font-size:15px;font-weight:500;color:${COLORS.navy900};line-height:1.5;text-align:right;">${value}</td>
          </tr>
        </table>
      </td>
    </tr>`;
}

/**
 * Wraps a list of `dataRow` strings in a card. Use for invoice
 * details, session details, plan summaries.
 */
export function dataCard(rows: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background-color:${COLORS.white};border:1px solid ${COLORS.lineSolid};border-radius:16px;">
      <tr>
        <td style="padding:6px 18px 6px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${rows}
          </table>
        </td>
      </tr>
    </table>`;
}

/**
 * Person card — avatar + name + role. Use in the Incoming Request
 * category to put a face on the request.
 *
 * **Why this avatar is a rounded square and not the brand hexagon.**
 * The hex was drawn with `clip-path`, which Outlook (every version),
 * Gmail webmail and Yahoo strip. The declaration next to it —
 * `border-radius:28px` on a 56px box — then took over, so the same
 * email showed a hexagon in Apple Mail and a *circle* everywhere else.
 * A rounded square degrades to a plain square when `border-radius` is
 * dropped, which still reads as intentional. Rendering a real brand
 * hex in email means shipping it as a raster image (inline SVG is
 * stripped by Gmail and unsupported in Outlook) — see LOGO_URL, which
 * is a PNG for exactly this reason.
 *
 * `avatarUrl` may be null; we render a honey tile with the first
 * initial as fallback. Every call site currently relies on that
 * fallback.
 */
export function personCard(params: {
  name: string;
  role: string;
  avatarUrl?: string | null;
  /** Optional one-line note ("Senior Pilates Coach · 4y on MotionHive"). */
  meta?: string;
}): string {
  const { name, role, avatarUrl, meta } = params;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const avatar = avatarUrl
    ? `<img src="${avatarUrl}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:16px;background-color:${COLORS.honey100};" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="56" height="56" align="center" style="width:56px;height:56px;background-color:${COLORS.honey};border-radius:16px;font-family:${FONT_DISPLAY};font-size:22px;font-weight:600;color:${COLORS.navy900};line-height:56px;text-align:center;letter-spacing:-0.02em;">${initial}</td></tr></table>`;

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background-color:${COLORS.surface50};border-radius:16px;">
      <tr>
        <td style="padding:18px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:56px;vertical-align:middle;">${avatar}</td>
              <td style="padding-left:14px;vertical-align:middle;font-family:${FONT_BODY};">
                <div style="font-family:${FONT_DISPLAY};font-size:17px;font-weight:600;color:${COLORS.navy900};letter-spacing:-0.01em;line-height:1.3;">${name}</div>
                <div style="margin-top:3px;font-size:13px;color:${COLORS.ink2};line-height:1.4;">${role}${meta ? ` &middot; ${meta}` : ''}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

/**
 * Date+time block — prominent display for the time-sensitive
 * category. Takes a date label, a time label, and a timezone.
 * Renders as a teal-accented card with the date as the headline,
 * time below, and timezone in muted tail copy.
 */
export function dateTimeBlock(params: {
  date: string;
  time: string;
  timezone?: string;
  location?: string;
}): string {
  const { date, time, timezone, location } = params;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background-color:${COLORS.teal50};border:1px solid ${COLORS.teal100};border-radius:16px;">
      <tr>
        <td style="padding:20px 22px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr class="stack-row">
              <td style="vertical-align:top;border-right:1px solid ${COLORS.teal100};padding-right:18px;width:55%;">
                <div style="font-family:${FONT_DISPLAY};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.teal700};line-height:1.2;">When</div>
                <div style="margin-top:6px;font-family:${FONT_DISPLAY};font-size:20px;font-weight:600;color:${COLORS.navy900};letter-spacing:-0.01em;line-height:1.25;">${date}</div>
                <div style="margin-top:4px;font-family:${FONT_DISPLAY};font-size:18px;font-weight:500;color:${COLORS.navy900};letter-spacing:-0.01em;line-height:1.3;">${time}</div>
                ${timezone ? `<div style="margin-top:4px;font-family:${FONT_BODY};font-size:12px;color:${COLORS.ink2};line-height:1.4;">${timezone}</div>` : ''}
              </td>
              <td style="vertical-align:top;padding-left:18px;">
                <div style="font-family:${FONT_DISPLAY};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.teal700};line-height:1.2;">Where</div>
                <div style="margin-top:6px;font-family:${FONT_BODY};font-size:15px;color:${COLORS.navy900};line-height:1.5;">${location || 'See details in the app'}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

/**
 * Standalone honey-50 hero band the template can render INSIDE the
 * content area — useful when you want the band to sit above the
 * eyebrow rather than under the header rule. Most templates won't
 * need this; the baseLayout option covers the common case.
 */
export function heroBand(): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:-40px -36px 28px -36px;width:auto;">
      <tr>
        <td style="background-color:${COLORS.honey50};background-image:${HONEYCOMB_DATA_URI};background-repeat:repeat;height:18px;font-size:1px;line-height:1px;border-bottom:1px solid ${COLORS.line};">&nbsp;</td>
      </tr>
    </table>`;
}

export function divider(): string {
  return `<hr class="mh-line" style="border:none;border-top:1px solid ${COLORS.lineSolid};margin:24px 0;">`;
}

export function expiryNote(text: string): string {
  return calloutBox(
    'warning',
    `<strong style="font-weight:600;">Heads up &middot;</strong> ${text}`,
  );
}

export function securityNote(text: string): string {
  return `<p class="mh-text-muted" style="margin:18px 0 0;font-family:${FONT_BODY};font-size:12px;color:${COLORS.ink3};line-height:1.6;">${text}</p>`;
}

/**
 * Single feature row (icon + text). Kept for back-compat with
 * `welcome.template.ts`. Prefer `dataRow` for new code unless you
 * specifically want the iconed layout.
 */
export function featureItem(icon: string, text: string): string {
  return `
    <tr>
      <td style="padding:8px 0;vertical-align:top;width:28px;font-family:${FONT_BODY};">
        <span style="font-size:16px;">${icon}</span>
      </td>
      <td style="padding:8px 0 8px 8px;font-family:${FONT_BODY};font-size:15px;color:${COLORS.navy900};line-height:1.55;">
        ${text}
      </td>
    </tr>`;
}

// ─────────────────────────────────────────────────────────────────────
// HONEYCOMB BACKGROUND PATTERN
// ─────────────────────────────────────────────────────────────────────

const HONEYCOMB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="32" viewBox="0 0 28 32"><g fill="none" stroke="#f59e0b" stroke-opacity="0.18" stroke-width="1"><polygon points="14,1 27,8.5 27,23.5 14,31 1,23.5 1,8.5"/></g></svg>`;

/**
 * Subtle hex-pattern data URI. Used by the heroBand. Inlined so it
 * works without an external host. Honey at low alpha so it reads as
 * texture, not pattern.
 *
 * **Base64, not percent-encoding — deliberately.** This value is
 * interpolated into a `style="…"` attribute, and every other encoding
 * has a quote that breaks out of it:
 *   - `url("…")` — the double quote closes the style attribute, so the
 *     whole declaration is dropped. (This was the original bug: the
 *     band rendered as a flat cream strip in every client.)
 *   - `url('…')` — `encodeURIComponent` leaves `'` untouched, and the
 *     SVG's own attribute quotes then close the CSS string early.
 *   - Bare `url(…)` — CSS forbids quotes and parens in an unquoted URL.
 * The base64 alphabet contains none of those characters, so the value
 * is inert wherever it lands.
 *
 * Degrades cleanly: Outlook ignores `background-image` on a `<td>` and
 * Gmail strips data URIs, both leaving the honey-50 background colour.
 */
const HONEYCOMB_DATA_URI = `url(data:image/svg+xml;base64,${Buffer.from(
  HONEYCOMB_SVG,
  'utf8',
).toString('base64')})`;

// ─────────────────────────────────────────────────────────────────────
// PLAIN-TEXT LAYOUT
// ─────────────────────────────────────────────────────────────────────

export interface PlainTextSection {
  /** Optional heading (rendered in CAPS with underline). */
  heading?: string;
  /** Body paragraphs — rendered with one blank line between each. */
  body?: string[];
  /** CTAs — rendered as "Label: <url>" lines. */
  ctas?: Array<{ label: string; url: string }>;
  /** Key/value detail rows — rendered as "Label: value". */
  details?: Array<{ label: string; value: string }>;
}

/**
 * Renders the plain-text alternative of an email. Every template
 * in phase 2 must export a sibling `<name>TemplateText(...)` that
 * passes its content through this helper. The shape is: brand line,
 * preheader, sections, footer.
 *
 * No HTML. No styling. Words only.
 */
export function plainTextLayout(params: {
  preheader?: string;
  sections: PlainTextSection[];
  /**
   * "Why am I getting this?" line. Additive — the trader identity and
   * policy links below it render either way. Mirrors
   * `BaseLayoutOptions.footerNote` so a template's HTML and text parts
   * can pass the same string.
   */
  footerNote?: string;
}): string {
  const { preheader, sections, footerNote } = params;
  const lines: string[] = [];

  lines.push('MotionHive');
  lines.push('motionhive.fit');
  lines.push('');
  if (preheader) {
    lines.push(preheader);
    lines.push('');
  }

  for (const s of sections) {
    if (s.heading) {
      lines.push(s.heading.toUpperCase());
      lines.push('-'.repeat(Math.min(60, s.heading.length)));
      lines.push('');
    }
    if (s.body) {
      for (const p of s.body) {
        lines.push(p);
        lines.push('');
      }
    }
    if (s.details && s.details.length) {
      for (const d of s.details) {
        lines.push(`${d.label}: ${d.value}`);
      }
      lines.push('');
    }
    if (s.ctas && s.ctas.length) {
      for (const c of s.ctas) {
        lines.push(`${c.label}: ${c.url}`);
      }
      lines.push('');
    }
  }

  lines.push('---');
  if (footerNote) {
    lines.push(footerNote);
    lines.push('');
  }
  lines.push(
    `${COMPANY.legalName} (${COMPANY.tradingName}) · ${COMPANY.address}`,
  );
  lines.push(COMPANY.contactEmail);
  lines.push(
    `Terms: ${LEGAL_URLS.terms} · Privacy: ${LEGAL_URLS.privacy} · Cookies: ${LEGAL_URLS.cookies}`,
  );
  lines.push(
    `(c) ${new Date().getFullYear()} ${COMPANY.tradingName}. All rights reserved.`,
  );

  return lines.join('\n');
}
