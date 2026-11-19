# Sign in with Apple: status and setup

2026-11-08. **Status: code written (API + iOS app + web app), not yet switched on.** It switches on once the Apple portal setup and the environment variables below are in place. It blocks the App Store release: the iOS app offers Google sign-in, so App Review requires Sign in with Apple (Guideline 4.8).

Full research (verification design, linking policy, relay email, sources): [`SIGN_IN_WITH_APPLE.md`](SIGN_IN_WITH_APPLE.md).

## Decisions

- **Team: HIVECRAFT S.R.L.** (Xcode team `AB34A8FY5K`, already ships TestFlight). No team transfer planned: a transfer changes every person's Apple id and relay address.
- **Platforms (owner, 2026-11-08, replacing "iOS only" from 7 Nov): the iOS app and the web app.** Android is not covered yet: Apple has no Android SDK, so it needs a redirect through the API and back into the app (plan step 16 in the research). Until then an Apple user on Android signs in with a password set through "Forgot password" (sent to their relay address) or with Google.
- **Unverified password account with the same email: still refused (409).** Linking it and dropping the unverified password stays an option for later.
- **The name** Apple shares only once: the client forwards it; an account made without one gets the usual `User` placeholder and is filled in on a later Apple sign-in that brings it.

## What the code does

| Part | Where |
|---|---|
| `POST /auth/apple`: checks the identity token against Apple's keys (RS256, issuer, audience = bundle id or Services ID, expiry, `sha256(rawNonce)` = `nonce`), trades the code for a refresh token outside the transaction, signs in, stores the token encrypted | API `src/modules/auth/apple/`, `auth.service.ts` `registerWithApple` |
| Revoke on account deletion: right after the deletion is scheduled, and again before erasure; never blocks either | `account-deletion.service.ts` `schedule()`, `account-erasure.service.ts` `erase()` |
| Migration 085: token columns on `social_account`, index on `lower(email)` | `migrations/085_sign_in_with_apple.sql` |
| Fixes that also help Google: emails stored lowercased and looked up ignoring case; Google's `email_verified` now checked before joining an account by email (Facebook never joins by email); invitations sent before sign-up linked for social sign-ups too | `user.service.ts`, `auth.service.ts` |
| iPhone: native Apple sheet through `@capgo/capacitor-social-login`, button above Google | UI `projects/mobile/src/app/pages/auth/` |
| Web: Apple's popup (Apple JS), button next to Google | UI `projects/core/src/lib/services/auth/`, `projects/web/src/app/pages/auth/_components/social-sign-in` |

The apps show the button from their own config (every iPhone; the web whenever its Services ID is set), so the API variables must be in place before those builds reach people: without a client id the route answers "not available". Without the key (`APPLE_KEY_ID` + `APPLE_PRIVATE_KEY`) or `TOKEN_ENCRYPTION_KEY`, people can still sign in; there is just nothing to revoke on deletion.

## Owner setup (about 1 hour)

Nothing secret needs to go through chat. If you use a different Services ID than `fit.motionhive.web`, say so: the web app has it in its config.

**developer.apple.com → Certificates, Identifiers & Profiles** (team HIVECRAFT S.R.L.)

1. **Identifiers → `fit.motionhive.app`** → tick *Sign in with Apple* → *Enable as a primary App ID* → Save. (The RestTimer extension does not need it.)
2. **Identifiers → + → Services IDs** → Description `MotionHive web`, Identifier **`fit.motionhive.web`** → Register. Open it, tick *Sign in with Apple* → Configure:
   - Primary App ID: `fit.motionhive.app`
   - Domains: `app.motionhive.fit`, `dev.app.motionhive.fit`
   - Return URLs: `https://app.motionhive.fit/auth/login`, `https://dev.app.motionhive.fit/auth/login`
   - Save, Continue, Save. (No verification file is needed. Apple refuses `localhost`, so the web button can only be tried on the dev or prod site.)
3. **Keys → +** → name `MotionHive Sign in with Apple`, tick *Sign in with Apple* → Configure → primary App ID `fit.motionhive.app` → Save → Continue → Register → **Download the .p8** (only once) and note the **Key ID**. One key serves both environments.
4. **Services → Sign in with Apple for Email Communication → Configure** → add `motionhive.fit` and `send.motionhive.fit` → check both show SPF passing. Without this, every email to a Hide My Email address bounces (password resets, invites, deletion codes).
5. **Profiles**: the App Store profile for `fit.motionhive.app` is invalidated by the new capability. Regenerate it and update the GitHub secret `IOS_PROVISIONING_PROFILE` (beeactive-ui, `ios-testflight.yml`). **The TestFlight build fails until this is done**, because the app now asks for the Sign in with Apple entitlement.

**Railway, both services** (dev and prod; TestFlight builds talk to the dev API):

| Variable | Dev | Prod |
|---|---|---|
| `APPLE_SERVICES_ID` | `fit.motionhive.web` | `fit.motionhive.web` |
| `APPLE_WEB_REDIRECT_URI` | `https://dev.app.motionhive.fit/auth/login` | `https://app.motionhive.fit/auth/login` |
| `APPLE_KEY_ID` | Key ID from step 3 | same |
| `APPLE_PRIVATE_KEY` | contents of the .p8, newlines written as `\n` (like `APNS_PRIVATE_KEY`) | same |
| `TOKEN_ENCRYPTION_KEY` | output of `openssl rand -base64 32` | a different one, same command |
| `APPLE_BUNDLE_ID`, `APPLE_TEAM_ID` | only if `APNS_BUNDLE_ID` / `APNS_TEAM_ID` are not set there (they are read as fallbacks) | same |

Never change `TOKEN_ENCRYPTION_KEY` once set: tokens stored with the old one could no longer be read (only revocation on deletion would suffer).

Then run migration 085 (deploys run it), and try: iPhone (TestFlight build signed in to iCloud) and `dev.app.motionhive.fit` in a browser, a new account and a returning one, and an account deletion (Settings → Apple ID → Sign in with Apple should drop MotionHive).

## Later, not needed for App Review

- Apple's server notifications (`email-disabled`, `email-enabled`, `consent-revoked`, `account-deleted`), production API only. Open question for the owner: when an Apple Account is deleted and the MotionHive account has no other way in, schedule its deletion or flag it for an admin?
- Android (redirect through the API, back into the app with a one-time ticket).
- A Sign-in methods screen (mobile + web) to connect Apple to an existing account and a security notice on every link.
- Account deletion when relay forwarding is off: accept a fresh Apple sign-in instead of the emailed code.
- Group invitations accepted by token for relay users.
- Hide relay addresses on public coach profiles.
- Stripe custom email domain, so relay users receive Stripe's invoice emails (open question).
- A unique index on `lower(email)` once production is checked for addresses differing only by case (the local database has none).
