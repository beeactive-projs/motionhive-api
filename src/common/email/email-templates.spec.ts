import * as templates from './index';
import { Locale, SUPPORTED_LOCALES } from '../i18n';
import {
  EMAIL_SAMPLES,
  EmailSample,
} from '../../../test/fixtures/email-samples';

/**
 * Every email the product sends, with realistic values, in every
 * language.
 *
 * The compiler checks that a template names copy that exists. It cannot
 * check that the rendered email comes out whole: no value left as
 * `undefined` or `null`, no ICU pattern printed raw, no markup leaking
 * into the plain-text part, no English typography in the Romanian one.
 * These do, on the same samples `scripts/send-email-previews.ts` sends.
 */

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const cache = new Map<string, Rendered>();

function render(sample: EmailSample, locale: Locale): Rendered {
  const key = `${locale}:${sample.name}`;
  let rendered = cache.get(key);
  if (!rendered) {
    rendered = {
      subject: sample.subject(locale),
      html: sample.html(locale),
      text: sample.text(locale),
    };
    cache.set(key, rendered);
  }
  return rendered;
}

/** A value that never made it into the sentence. */
const UNRENDERED = /undefined|\bnull\b|NaN|Invalid Date|\[object Object\]/;
/** An ICU pattern printed as written: `{name}`, `{count, plural, …}`. */
const ICU_LEFTOVER = /\{[a-zA-Z_]+[,}]/;
/** The layout's own CSS is the one place braces belong. */
const withoutStyleBlock = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, '');

const HTML_TAG = /<[a-z][^>]*>/i;
const HTML_ENTITY = /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i;

/** No dashes in any language; Romanian also avoids the legacy cedilla letters. */
const DASH = /[—–]/;
const CEDILLA = /[şţŞŢ]/;

describe('email samples', () => {
  it('cover every template exported from the barrel', () => {
    const exported = Object.keys(templates).filter((name) =>
      name.endsWith('Template'),
    );
    const sampled = new Set<string>(EMAIL_SAMPLES.map((s) => s.templateName));
    expect(exported.length).toBeGreaterThan(0);
    expect(exported.filter((name) => !sampled.has(name))).toEqual([]);
  });

  it('every template has a plain-text twin', () => {
    const exported = templates as Record<string, unknown>;
    const missing = Object.keys(exported)
      .filter((name) => name.endsWith('Template'))
      .filter((name) => typeof exported[`${name}Text`] !== 'function');
    expect(missing).toEqual([]);
  });

  it('have unique names', () => {
    const names = EMAIL_SAMPLES.map((s) => s.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});

describe.each(SUPPORTED_LOCALES)('emails rendered in %s', (locale) => {
  const rendered = (sample: EmailSample) => render(sample, locale);

  it.each(EMAIL_SAMPLES)(
    '$name has a subject, an HTML part and a text part',
    (sample) => {
      const r = rendered(sample);
      for (const part of [r.subject, r.html, r.text]) {
        expect(typeof part).toBe('string');
        expect(part.trim()).not.toBe('');
      }
    },
  );

  it.each(EMAIL_SAMPLES)(
    '$name leaves no value or pattern unrendered',
    (sample) => {
      const r = rendered(sample);
      for (const part of [r.subject, withoutStyleBlock(r.html), r.text]) {
        expect(part).not.toMatch(UNRENDERED);
        expect(part).not.toMatch(ICU_LEFTOVER);
      }
    },
  );

  it.each(EMAIL_SAMPLES)(
    '$name leaves no gap where a value was missing',
    (sample) => {
      const r = rendered(sample);
      for (const line of [r.subject, ...r.text.split('\n')]) {
        // No doubled or dangling spaces left behind by an empty branch.
        expect(line).not.toMatch(/ {2}| [.,!?]|^ | $/);
      }
    },
  );

  it.each(EMAIL_SAMPLES)(
    '$name opens the HTML document in its language',
    (sample) => {
      expect(rendered(sample).html).toMatch(
        new RegExp(`^<!DOCTYPE html>\\s*<html lang="${locale}"`),
      );
    },
  );

  it.each(EMAIL_SAMPLES)(
    '$name keeps markup out of the subject and the text part',
    (sample) => {
      const r = rendered(sample);
      for (const part of [r.subject, r.text]) {
        expect(part).not.toContain('**');
        expect(part).not.toMatch(HTML_TAG);
        expect(part).not.toMatch(HTML_ENTITY);
      }
    },
  );

  it.each(EMAIL_SAMPLES)('$name uses no dash as punctuation', (sample) => {
    const r = rendered(sample);
    for (const part of [r.subject, r.text]) {
      expect(part).not.toMatch(DASH);
    }
  });

  if (locale === 'ro') {
    it.each(EMAIL_SAMPLES)('$name uses Romanian letters', (sample) => {
      const r = rendered(sample);
      for (const part of [r.subject, r.text]) {
        expect(part).not.toMatch(CEDILLA);
      }
    });
  }
});

describe('escaping', () => {
  const HOSTILE = '<img src=x onerror=alert(1)> & co';
  const LINK = 'https://app.motionhive.fit/preview';

  /** Templates that print a person's name, a group's name or free text. */
  const hostile: Array<[string, (locale: Locale) => string]> = [
    [
      'auth/welcome',
      (locale) => templates.welcomeTemplate(HOSTILE, LINK, locale),
    ],
    [
      'auth/password-changed',
      (locale) =>
        templates.passwordChangedTemplate({
          firstName: HOSTILE,
          changedAt: new Date('2026-10-01T15:30:00Z'),
          timeZone: 'Europe/Bucharest',
          resetLink: LINK,
          locale,
        }),
    ],
    [
      'group/invitation',
      (locale) =>
        templates.invitationTemplate(HOSTILE, HOSTILE, LINK, HOSTILE, locale),
    ],
    [
      'group/invitation-accepted',
      (locale) =>
        templates.invitationAcceptedTemplate(
          HOSTILE,
          HOSTILE,
          HOSTILE,
          LINK,
          locale,
        ),
    ],
    [
      'group/invitation-declined',
      (locale) =>
        templates.invitationDeclinedTemplate(HOSTILE, HOSTILE, HOSTILE, locale),
    ],
    [
      'group/member-left',
      (locale) =>
        templates.groupMemberLeftTemplate({
          ownerFirstName: HOSTILE,
          memberName: HOSTILE,
          groupName: HOSTILE,
          groupLink: LINK,
          locale,
        }),
    ],
    [
      'group/member-removed',
      (locale) =>
        templates.groupMemberRemovedTemplate({
          memberFirstName: HOSTILE,
          groupName: HOSTILE,
          groupsListLink: LINK,
          locale,
        }),
    ],
    [
      'group/join-request-received',
      (locale) =>
        templates.groupJoinRequestReceivedTemplate({
          ownerFirstName: HOSTILE,
          requesterName: HOSTILE,
          groupName: HOSTILE,
          reviewLink: LINK,
          message: HOSTILE,
          locale,
        }),
    ],
    ...(['received', 'transferred'] as const).map(
      (direction): [string, (locale: Locale) => string] => [
        `group/ownership-transferred:${direction}`,
        (locale) =>
          templates.groupOwnershipTransferredTemplate({
            direction,
            recipientFirstName: HOSTILE,
            otherPartyName: HOSTILE,
            groupName: HOSTILE,
            groupLink: LINK,
            locale,
          }),
      ],
    ),
    ...(['approved', 'rejected'] as const).map(
      (decision): [string, (locale: Locale) => string] => [
        `group/join-request-decided:${decision}`,
        (locale) =>
          templates.groupJoinRequestDecidedTemplate({
            decision,
            requesterFirstName: HOSTILE,
            groupName: HOSTILE,
            groupLink: LINK,
            groupsListLink: LINK,
            locale,
          }),
      ],
    ),
    [
      'group/role-changed',
      (locale) =>
        templates.groupRoleChangedTemplate({
          memberFirstName: HOSTILE,
          groupName: HOSTILE,
          oldRole: 'MEMBER',
          newRole: 'MODERATOR',
          groupLink: LINK,
          locale,
        }),
    ],
    [
      'client/invitation-new-user',
      (locale) =>
        templates.clientInvitationNewUserTemplate({
          instructorName: HOSTILE,
          signUpLink: LINK,
          message: HOSTILE,
          locale,
        }),
    ],
    [
      'client/invitation-existing-user',
      (locale) =>
        templates.clientInvitationExistingUserTemplate({
          recipientFirstName: HOSTILE,
          instructorName: HOSTILE,
          acceptLink: LINK,
          message: HOSTILE,
          locale,
        }),
    ],
    [
      'client/invitation-imported',
      (locale) =>
        templates.clientInvitationImportedTemplate({
          recipientFirstName: HOSTILE,
          instructorName: HOSTILE,
          // personCard puts the URL straight into src="…".
          instructorAvatarUrl: HOSTILE,
          link: LINK,
          hasAccount: false,
          message: HOSTILE,
          locale,
        }),
    ],
    [
      'client/request-to-instructor',
      (locale) =>
        templates.clientRequestToInstructorTemplate({
          instructorFirstName: HOSTILE,
          clientName: HOSTILE,
          reviewLink: LINK,
          message: HOSTILE,
          locale,
        }),
    ],
    [
      'client/request-accepted',
      (locale) =>
        templates.clientRequestAcceptedTemplate({
          recipientFirstName: HOSTILE,
          responderName: HOSTILE,
          recipientRole: 'instructor',
          appLink: LINK,
          locale,
        }),
    ],
    [
      'client/request-declined',
      (locale) =>
        templates.clientRequestDeclinedTemplate({
          recipientFirstName: HOSTILE,
          responderName: HOSTILE,
          recipientRole: 'instructor',
          locale,
        }),
    ],
    [
      'client/collaboration-ended',
      (locale) =>
        templates.collaborationEndedTemplate({
          recipientName: HOSTILE,
          otherPartyName: HOSTILE,
          endedBy: 'other',
          recipientRole: 'client',
          locale,
        }),
    ],
    [
      'social/friend-invite',
      (locale) =>
        templates.friendInviteTemplate({
          inviterName: HOSTILE,
          signUpLink: LINK,
          personalMessage: HOSTILE,
          locale,
        }),
    ],
    [
      'social/instructor-suggestion',
      (locale) =>
        templates.instructorSuggestionTemplate({
          coachName: HOSTILE,
          recommenderName: HOSTILE,
          signUpLink: LINK,
          note: HOSTILE,
          locale,
        }),
    ],
    [
      'invoice/send',
      (locale) =>
        templates.invoiceSendTemplate({
          instructorName: HOSTILE,
          amountCents: 25000,
          currency: 'ron',
          dueDate: '2026-06-30',
          invoiceNumber: HOSTILE,
          hostedInvoiceUrl: LINK,
          invoicePdfUrl: LINK,
          recipientName: HOSTILE,
          locale,
        }),
    ],
    [
      'subscription/setup',
      (locale) =>
        templates.subscriptionSetupTemplate({
          instructorName: HOSTILE,
          planName: HOSTILE,
          amountCents: 25000,
          currency: 'ron',
          interval: 'month',
          intervalCount: 1,
          setupUrl: LINK,
          recipientName: HOSTILE,
          locale,
        }),
    ],
    [
      'waitlist/confirmation',
      (locale) =>
        templates.waitlistConfirmationTemplate(
          HOSTILE,
          'https://app.motionhive.fit/auth/signup',
          locale,
        ),
    ],
    [
      'feedback/confirmation',
      (locale) =>
        templates.feedbackConfirmationTemplate('BUG', HOSTILE, HOSTILE, locale),
    ],
    [
      'notification/generic',
      (locale) =>
        templates.genericNotificationTemplate({
          title: HOSTILE,
          body: HOSTILE,
          locale,
          ctaUrl: LINK,
          ctaLabel: HOSTILE,
        }),
    ],
  ];

  describe.each(SUPPORTED_LOCALES)('in %s', (locale) => {
    it.each(hostile)(
      '%s escapes names and messages exactly once',
      (_name, html) => {
        const out = html(locale);
        // The value is there, as text…
        expect(out).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; co');
        // …never as markup, and never escaped twice.
        expect(out).not.toContain('<img src=x');
        expect(out).not.toMatch(/&amp;(?:lt|gt|amp|quot|#39);/);
      },
    );
  });
});
