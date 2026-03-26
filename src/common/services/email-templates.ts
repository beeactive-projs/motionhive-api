/**
 * MotionHive Email Templates
 *
 * Branded email templates matching the app's design:
 * - Dark navy (#0f172a) header/footer
 * - Orange/amber (#f59e0b) accent color
 * - Clean white content area
 * - Cloudinary-hosted logo
 *
 * All templates use the base layout for consistent branding.
 */

// =====================================================
// BRAND COLORS (from MotionHive UI)
// =====================================================

const LOGO_URL =
  'https://res.cloudinary.com/dom4dfr1q/image/upload/v1773687604/motionhive-logo.png';

const COLORS = {
  bgDark: '#0f172a', // Dark navy background
  bgDarker: '#0a1628', // Even darker navy
  bgOuter: '#f4f4f5', // Light outer background
  bgCard: '#1e293b', // Card background
  accent: '#f59e0b', // Orange/amber accent
  navyDefault: '#1E3A5F',
  accentHover: '#d97706', // Darker amber
  accentLight: '#fef3c7', // Light amber
  highlightBg: '#fefce8', // Warm yellow highlight
  highlightText: '#92400e', // Dark amber text
  highlightStrong: '#78350f', // Darker amber text
  cardBg: '#f8fafc', // Summary card background
  cardBorder: '#e2e8f0', // Summary card border
  textWhite: '#ffffff',
  textLight: '#e2e8f0',
  textMuted: '#94a3b8',
  textMutedFooter: '#64748b',
  textDark: '#1e293b',
  textBody: '#27272a', // Updated to match new templates
  textBodyAlt: '#334155',
  green: '#22c55e',
  greenBg: '#052e16',
  border: '#1e293b',
  contentBg: '#ffffff',
  footerBg: '#0f172a',
};

// =====================================================
// BASE LAYOUT
// =====================================================

/**
 * Wraps email content in the branded base layout.
 *
 * Structure:
 * - Dark navy header with lightning bolt + BeeActive logo
 * - White content area
 * - Dark navy footer with links
 */
function baseLayout(
  content: string,
  preheader?: string,
  footerNote?: string,
): string {
  const FONT =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

// =====================================================
// SHARED COMPONENTS
// =====================================================

function primaryButton(text: string, href: string): string {
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

function heading(text: string): string {
  return `<h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:${COLORS.textDark};line-height:1.3;">${text}</h1>`;
}

function subheading(text: string): string {
  return `<p style="margin:0 0 24px;font-size:15px;color:${COLORS.textMuted};line-height:1.5;">${text}</p>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:${COLORS.textBody};line-height:1.6;">${text}</p>`;
}

function expiryNote(text: string): string {
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

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">`;
}

function securityNote(text: string): string {
  return `<p style="margin:16px 0 0;font-size:12px;color:${COLORS.textMuted};line-height:1.5;">${text}</p>`;
}

function featureItem(icon: string, text: string): string {
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

// =====================================================
// EMAIL TEMPLATES
// =====================================================

export function emailVerificationTemplate(verifyLink: string): string {
  const content = `
    ${heading('Verify your email')}
    ${subheading('One quick step to get started')}
    ${paragraph('Thanks for signing up for MotionHive! Please verify your email address to unlock all features and start your fitness journey.')}
    ${primaryButton('&#9989; Verify email address', verifyLink)}
    ${expiryNote('This verification link expires in <strong>24 hours</strong>.')}
    ${securityNote("If you didn't create a MotionHive account, you can safely ignore this email.")}
  `;

  return baseLayout(
    content,
    'Verify your email to get started with MotionHive',
  );
}

export function welcomeTemplate(
  firstName: string,
  frontendUrl: string,
): string {
  const content = `
    ${heading(`Welcome, ${firstName}! &#9889;`)}
    ${subheading("You're all set to start your journey towards a healthier and more active lifestyle")}
    ${paragraph("Your MotionHive account is ready. Here's what you can do:")}

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      ${featureItem('&#127947;', '<strong>Join sessions</strong> — Find and participate in sessions that match your goals and preferences')}
      ${featureItem('&#129309;', '<strong>Connect with professionals</strong> — Get personalized guidance')}
      ${featureItem('&#127942;', '<strong>Organize your own events and sessions</strong> — Create sessions and build your community')}
    </table>

    ${primaryButton('&#127775; Get started', frontendUrl)}
    ${divider()}
    ${paragraph("Need help? Just reply to this email — we're happy to assist.")}
  `;

  return baseLayout(content, `Welcome to MotionHive, ${firstName}!`);
}

export function passwordResetTemplate(resetLink: string): string {
  const content = `
    ${heading('Reset your password')}
    ${subheading('We received a password reset request')}
    ${paragraph("Click the button below to choose a new password. If you didn't make this request, you can safely ignore this email — your password won't change.")}
    ${primaryButton('&#128273; Reset password', resetLink)}
    ${expiryNote('This reset link expires in <strong>1 hour</strong> and can only be used once.')}
    ${securityNote("If you didn't request a password reset, someone may have entered your email by mistake. No changes have been made to your account.")}
  `;

  return baseLayout(content, 'Reset your MotionHive password');
}

export function invitationTemplate(
  inviterName: string,
  groupName: string,
  acceptLink: string,
  message?: string,
): string {
  const messageBlock = message
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px;">
        <tr>
          <td style="background-color:#f8fafc;border-radius:8px;padding:16px 20px;border-left:4px solid ${COLORS.accent};">
            <p style="margin:0 0 4px;font-size:12px;color:${COLORS.textMuted};text-transform:uppercase;letter-spacing:0.5px;">Personal message</p>
            <p style="margin:0;font-size:15px;color:${COLORS.textBody};font-style:italic;line-height:1.5;">"${message}"</p>
          </td>
        </tr>
      </table>`
    : '';

  const content = `
    ${heading("You're invited!")}
    ${subheading(`${inviterName} wants you to join their team`)}
    ${paragraph(`<strong>${inviterName}</strong> has invited you to join <strong>${groupName}</strong> on MotionHive — a fitness platform for instructors and clients.`)}
    ${messageBlock}
    ${primaryButton('&#129309; Accept invitation', acceptLink)}
    ${divider()}
    <p style="margin:0 0 16px;font-size:14px;color:${COLORS.textBody};line-height:1.5;">
      By accepting, you'll be added as a member of <strong>${groupName}</strong> and can start joining training sessions.
    </p>
    ${expiryNote('This invitation expires in <strong>7 days</strong>.')}
    ${securityNote("If you don't know the person who sent this, you can safely ignore this email.")}
  `;

  return baseLayout(content, `${inviterName} invited you to join ${groupName}`);
}

export function sessionCancelledTemplate(
  participantName: string,
  sessionTitle: string,
  instructorName: string,
  scheduledAt: string,
): string {
  const content = `
    ${heading('Session cancelled')}
    ${subheading(`A session you were registered for has been cancelled`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#fef2f2;border-radius:8px;padding:20px;border-left:4px solid #ef4444;">
          <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#991b1b;">${sessionTitle}</p>
          <p style="margin:0 0 4px;font-size:14px;color:#7f1d1d;">Instructor: ${instructorName}</p>
          <p style="margin:0;font-size:14px;color:#7f1d1d;">Scheduled: ${scheduledAt}</p>
        </td>
      </tr>
    </table>

    ${paragraph(`Hi ${participantName}, the instructor has cancelled this session. We apologize for any inconvenience.`)}
    ${divider()}
    ${paragraph('You can browse other available sessions on the platform.')}
  `;

  return baseLayout(content, `Session "${sessionTitle}" has been cancelled`);
}

export function invitationAcceptedTemplate(
  inviterName: string,
  accepterName: string,
  groupName: string,
): string {
  const content = `
    ${heading('Invitation accepted!')}
    ${subheading(`Great news — someone joined your group`)}
    ${paragraph(`Hi ${inviterName}, <strong>${accepterName}</strong> has accepted your invitation and joined <strong>${groupName}</strong>.`)}
    ${divider()}
    ${paragraph('You can view your group members in the MotionHive app.')}
  `;

  return baseLayout(
    content,
    `${accepterName} accepted your invitation to ${groupName}`,
  );
}

export function participantStatusTemplate(
  participantName: string,
  sessionTitle: string,
  newStatus: string,
  scheduledAt: string,
): string {
  const statusLabels: Record<string, string> = {
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
    ATTENDED: 'marked as attended',
    NO_SHOW: 'marked as no-show',
  };
  const statusLabel = statusLabels[newStatus] || newStatus.toLowerCase();

  const content = `
    ${heading('Session status update')}
    ${subheading(`Your registration status has changed`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#f8fafc;border-radius:8px;padding:20px;border-left:4px solid ${COLORS.accent};">
          <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:${COLORS.textDark};">${sessionTitle}</p>
          <p style="margin:0 0 4px;font-size:14px;color:${COLORS.textBody};">Scheduled: ${scheduledAt}</p>
          <p style="margin:0;font-size:14px;color:${COLORS.textBody};">Status: <strong>${statusLabel}</strong></p>
        </td>
      </tr>
    </table>

    ${paragraph(`Hi ${participantName}, your registration for this session has been ${statusLabel} by the instructor.`)}
  `;

  return baseLayout(content, `Your session status has been updated`);
}

export function waitlistConfirmationTemplate(name?: string): string {
  const greeting = name ? `Hi ${name},` : 'Hi there,';

  const content = `
    ${heading("You're on the list! &#127881;")}
    ${subheading('Thanks for your interest in MotionHive')}
    ${paragraph(`${greeting} we're thrilled that you want to be part of the MotionHive community.`)}
    ${paragraph("We're working hard to build a platform that makes fitness more accessible, social, and fun. You'll be among the <strong>first to know</strong> when we launch.")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background-color:${COLORS.highlightBg};border-radius:8px;padding:16px 20px;border-left:4px solid ${COLORS.accent};">
          <p style="margin:0;font-size:14px;color:${COLORS.highlightStrong};line-height:1.5;">
            &#128640; <strong>What happens next?</strong> We'll send you an invite as soon as early access opens. Stay tuned!
          </p>
        </td>
      </tr>
    </table>

    ${divider()}
    ${paragraph('In the meantime, follow us for updates and sneak peeks.')}
  `;

  return baseLayout(
    content,
    "You're on the MotionHive waitlist!",
    "You're receiving this because you signed up for the MotionHive waitlist.",
  );
}

export function feedbackConfirmationTemplate(
  type: string,
  title: string,
  name?: string,
): string {
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  const content = `
    ${heading('Feedback received &#9989;')}
    ${subheading('We appreciate you taking the time to write to us')}
    ${paragraph(`${greeting} thank you for your ${type}. Every piece of feedback helps us build a better platform.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px;">
      <tr>
        <td style="background-color:${COLORS.cardBg};border:1px solid ${COLORS.cardBorder};border-radius:8px;padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:12px;color:${COLORS.textMuted};text-transform:uppercase;letter-spacing:0.5px;">Your ${typeLabel}</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:${COLORS.textDark};line-height:1.4;">${title}</p>
        </td>
      </tr>
    </table>

    ${paragraph("Our team reviews every submission. While we can't respond to each one individually, your input directly shapes what we build next.")}
    ${divider()}
    ${paragraph('Thanks for helping us improve MotionHive!')}
  `;

  return baseLayout(
    content,
    'Thanks for your feedback!',
    "You're receiving this because you submitted feedback on MotionHive.",
  );
}

export function sessionReminderTemplate(
  participantName: string,
  sessionTitle: string,
  instructorName: string,
  scheduledAt: string,
  location: string,
): string {
  // TODO: [JOB SYSTEM] This template is ready — wire it up when the reminder job system is built
  const content = `
    ${heading('Session reminder')}
    ${subheading("Don't forget — your session is coming up!")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#f0fdf4;border-radius:8px;padding:20px;border-left:4px solid ${COLORS.green};">
          <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#166534;">${sessionTitle}</p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            ${featureItem('&#128197;', `<strong>When:</strong> ${scheduledAt}`)}
            ${featureItem('&#128205;', `<strong>Where:</strong> ${location}`)}
            ${featureItem('&#128100;', `<strong>Instructor:</strong> ${instructorName}`)}
          </table>
        </td>
      </tr>
    </table>

    ${paragraph(`Hi ${participantName}, get ready for your upcoming session!`)}
  `;

  return baseLayout(content, `Reminder: "${sessionTitle}" is coming up`);
}
