/**
 * BeeActive Email Templates
 *
 * Branded email templates matching the app's design:
 * - Dark navy (#0f172a) header/footer
 * - Orange/amber (#f59e0b) accent color
 * - Clean white content area
 * - Lightning bolt branding
 *
 * All templates use the base layout for consistent branding.
 */

// =====================================================
// BRAND COLORS (from BeeActive UI)
// =====================================================

const COLORS = {
  bgDark: '#0f172a', // Dark navy background
  bgDarker: '#0a1628', // Even darker navy
  bgCard: '#1e293b', // Card background
  accent: '#f59e0b', // Orange/amber accent
  accentHover: '#d97706', // Darker amber
  accentLight: '#fef3c7', // Light amber
  textWhite: '#ffffff',
  textLight: '#e2e8f0',
  textMuted: '#94a3b8',
  textDark: '#1e293b',
  textBody: '#334155',
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
function baseLayout(content: string, preheader?: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>BeeActive</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${COLORS.bgDarker};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : ''}

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bgDarker};">
    <tr>
      <td align="center" style="padding:24px 16px;">

        <!-- Email container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="background-color:${COLORS.bgDark};padding:32px 40px;border-radius:16px 16px 0 0;text-align:center;">
              <!-- Logo -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="background-color:${COLORS.accent};width:40px;height:40px;border-radius:10px;text-align:center;vertical-align:middle;">
                    <span style="font-size:22px;line-height:40px;">&#9889;</span>
                  </td>
                  <td style="padding-left:12px;">
                    <span style="font-size:24px;font-weight:700;color:${COLORS.textWhite};letter-spacing:-0.5px;">Bee</span><span style="font-size:24px;font-weight:700;color:${COLORS.accent};letter-spacing:-0.5px;">Active</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CONTENT -->
          <tr>
            <td style="background-color:${COLORS.contentBg};padding:40px 40px 32px;">
              ${content}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background-color:${COLORS.bgDark};padding:28px 40px;border-radius:0 0 16px 16px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:${COLORS.textMuted};">
                &copy; ${new Date().getFullYear()} BeeActive. All rights reserved.
              </p>
              <p style="margin:0;font-size:12px;color:${COLORS.textMuted};">
                Transform your lifestyle today
              </p>
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
          <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:${COLORS.textWhite};text-decoration:none;border-radius:8px;background-color:${COLORS.accent};">
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
    ${heading('Verify Your Email')}
    ${subheading('One quick step to get started')}
    ${paragraph('Thanks for signing up for BeeActive! Please verify your email address to unlock all features and start your fitness journey.')}
    ${primaryButton('Verify Email Address', verifyLink)}
    ${expiryNote('This verification link expires in <strong>24 hours</strong>.')}
    ${securityNote("If you didn't create a BeeActive account, you can safely ignore this email.")}
  `;

  return baseLayout(content, 'Verify your email to get started with BeeActive');
}

export function welcomeTemplate(
  firstName: string,
  frontendUrl: string,
): string {
  const content = `
    ${heading(`Welcome, ${firstName}! &#9889;`)}
    ${subheading("You're all set to start your journey towards a healthier and more active lifestyle")}
    ${paragraph("Your beeactive account is ready. Here's what you can do:")}

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      ${featureItem('&#127947;', '<strong>Join sessions</strong> — Find and participate in sessions that match your goals and preferences')}
      ${featureItem('&#129309;', '<strong>Connect with professionals</strong> — Get personalized guidance')}
      ${featureItem('&#127942;', '<strong>Organize your own events and sessions</strong> — Create sessions and build your community')}
    </table>

    ${primaryButton('Get Started', frontendUrl)}
    ${divider()}
    ${paragraph("Need help? Just reply to this email — we're happy to assist.")}
  `;

  return baseLayout(content, `Welcome to BeeActive, ${firstName}!`);
}

export function passwordResetTemplate(resetLink: string): string {
  const content = `
    ${heading('Reset Your Password')}
    ${subheading('We received a password reset request')}
    ${paragraph("Click the button below to choose a new password. If you didn't make this request, you can safely ignore this email — your password won't change.")}
    ${primaryButton('Reset Password', resetLink)}
    ${expiryNote('This reset link expires in <strong>1 hour</strong> and can only be used once.')}
    ${securityNote("If you didn't request a password reset, someone may have entered your email by mistake. No changes have been made to your account.")}
  `;

  return baseLayout(content, 'Reset your BeeActive password');
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
    ${heading("You're Invited!")}
    ${subheading(`${inviterName} wants you to join their team`)}
    ${paragraph(`<strong>${inviterName}</strong> has invited you to join <strong>${groupName}</strong> on BeeActive — a fitness platform for instructors and clients.`)}
    ${messageBlock}
    ${primaryButton('Accept Invitation', acceptLink)}
    ${divider()}
    <p style="margin:0 0 16px;font-size:14px;color:${COLORS.textBody};line-height:1.5;">
      By accepting, you'll be added as a member of <strong>${groupName}</strong> and can start joining training sessions.
    </p>
    ${expiryNote('This invitation expires in <strong>7 days</strong>.')}
    ${securityNote("If you don't know the person who sent this, you can safely ignore this email.")}
  `;

  return baseLayout(
    content,
    `${inviterName} invited you to join ${groupName}`,
  );
}

export function sessionCancelledTemplate(
  participantName: string,
  sessionTitle: string,
  instructorName: string,
  scheduledAt: string,
): string {
  const content = `
    ${heading('Session Cancelled')}
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
    ${heading('Invitation Accepted!')}
    ${subheading(`Great news — someone joined your group`)}
    ${paragraph(`Hi ${inviterName}, <strong>${accepterName}</strong> has accepted your invitation and joined <strong>${groupName}</strong>.`)}
    ${divider()}
    ${paragraph('You can view your group members in the BeeActive app.')}
  `;

  return baseLayout(content, `${accepterName} accepted your invitation to ${groupName}`);
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
    ${heading('Session Status Update')}
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

export function sessionReminderTemplate(
  participantName: string,
  sessionTitle: string,
  instructorName: string,
  scheduledAt: string,
  location: string,
): string {
  // TODO: [JOB SYSTEM] This template is ready — wire it up when the reminder job system is built
  const content = `
    ${heading('Session Reminder')}
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
