# Sign in with Apple, iOS only: plan and estimate

2026-11-07. **Status: on hold.** Onboarding (categories + account setup) goes first, through Claude Design (`../onboarding/ONBOARDING_AND_CATEGORIES.md`). Apple starts after that, but **it blocks the App Store release**: the iOS app offers Google sign-in, so App Review requires Sign in with Apple (Guideline 4.8). Start it no later than about a week before the first App Store submission.

Full research (setup details, token verification design, linking policy, sources): [`SIGN_IN_WITH_APPLE.md`](SIGN_IN_WITH_APPLE.md). Step numbers below refer to its section 8.

## Decisions

- **Team: HIVECRAFT S.R.L.**, the team that already ships TestFlight builds. The Xcode project signs the app (`fit.motionhive.app`) and the RestTimer extension with team `AB34A8FY5K`. Confirm on developer.apple.com → Membership that this team's entity is HIVECRAFT S.R.L. (installing on a phone proves a paid membership, not which one). No team transfer planned.
- **Apple on iOS only.** No web button, no Android. The API accepts one audience, the bundle id `fit.motionhive.app`. No Services ID, return URLs or domain verification needed.

## Effort: about 4 to 5 days, plus 1 hour of portal setup

| Part | Who | Size | Steps |
|---|---|---|---|
| Apple portal: enable Sign in with Apple on `fit.motionhive.app`; create a Sign in with Apple key (.p8, note Key ID + Team ID); register `motionhive.fit` and `send.motionhive.fit` with Private Email Relay (SPF/DKIM via Resend); regenerate the app's provisioning profile and update the TestFlight secret | owner | ~1 hour | 0 |
| Fixes that also help Google: lowercase emails on every write and lookup (check for case duplicates, then a unique index on `lower(email)`), check Google's `email_verified`, run `linkPendingInvitations` for new social sign-ups, hide relay emails on public coach profiles | API | ~1 day, do first | 1 |
| Apple sign-in on the API: migration 081 (token columns on `social_account`; `APPLE` already exists in the enum), `CryptoService` encrypt/decrypt + `TOKEN_ENCRYPTION_KEY`, `AppleIdentityService` (Apple's keys, nonce, client secret, code exchange, revoke), `POST /auth/apple` saving the name Apple sends only on the first sign-in, revoke on account deletion, tests, EN + RO error keys | API | ~2.5 days | 2 to 6 |
| iPhone app: `apple: true` in the social login plugin config + Xcode entitlement, `AppleSignInService` next to `google-sign-in.service.ts` (nonce, forward name), Apple button first in `social-sign-in` following Apple's rules, clear cached Apple info on account deletion, EN + RO strings, device test | mobile | ~1 day | 9 |

The button is the easy part (the installed `@capgo/capacitor-social-login` already does Apple on iOS). The careful work is the token check (security code), keeping the name (Apple sends it once) and storing Apple's token encrypted (needed to revoke on deletion).

## Later, not needed for App Review (about 4 to 5 more days)

- Apple's server notifications endpoint (`email-disabled`, `email-enabled`, `consent-revoked`, `account-deleted`), production API only (step 7).
- Sign-in methods screen (mobile + web) + a security notice on every link (step 8, 11).
- Account deletion when relay forwarding is off: accept a fresh Apple sign-in as proof (step 12).
- Group invitations accepted by token for relay users (step 13).
- "Link it instead" for brand-new duplicate accounts (step 15).
- Facebook Limited Login on the API (step 14): needed **before** Facebook goes on iOS, independent of Apple.

## What iOS-only means for people

Someone who signs up with Apple on the iPhone has no Apple button on the web app or on Android. There they sign in with a password set through "Forgot password" (sent to their relay address), or with Google once they connect it in Sign-in methods. So **relay email registration is required**, otherwise that reset never arrives. The Claude Design brief covers it (S9, "Set a password").

## Still open for the owner

1. `account-deleted` for an Apple-only account: auto-schedule deletion, or flag for an admin?
2. Unverified password account with the same email: keep refusing (409), or link Apple and drop the unverified password?
3. Stripe custom email domain, so relay users receive Stripe's invoice emails?
