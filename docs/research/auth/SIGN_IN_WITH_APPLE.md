# Sign in with Apple for MotionHive

Research, 2026-11-07. Built 2026-11-08 for iOS and the web (see `APPLE_SIGN_IN_IOS_PLAN.md`); the migration sketched below as 081 shipped as 085 (084 went to the online venue change). Covers the API (`beeactive-api`), the apps (`beeactive-ui`: `mobile`, `web`, `core`), the Apple and Meta rules, and how this fits our existing Google / Facebook sign-in, account deletion and email.

Items marked **(unverified)** could not be confirmed against a primary source and need checking during the build.

---

## TL;DR

- **Required:** yes, for the App Store release. The iOS app offers Google sign-in, which triggers Guideline 4.8, and email/password does not satisfy it. Without Sign in with Apple (or without removing Google from iOS) expect a 4.8 rejection.
- **Effort:** about 4 to 5 dev days for the minimum App Review needs (API sign-in + iOS button + token revoke on deletion + relay email setup); about 2 weeks for the full set (web, linking settings, Apple notifications, Facebook Limited Login). `APPLE` already exists in the DB enum.
- **Risk 1, duplicate accounts:** Hide My Email gives a relay address that never matches the person's Google or email/password account, so they get a second, empty account.
- **Risk 2, email to relay addresses bounces** unless `motionhive.fit` and `send.motionhive.fit` are registered with Apple. Stripe-sent invoice emails come from `stripe.com` and will bounce. Account deletion codes also stop arriving if the person turns forwarding off.
- **Risk 3, Facebook on iOS will break the current `POST /auth/facebook`:** the app has no tracking prompt, so the Facebook SDK always uses Limited Login, which returns an OIDC token and no Graph access token.

---

## 0. What the code does today

| Fact | Where |
|---|---|
| `enum_social_provider` already has `'GOOGLE', 'FACEBOOK', 'APPLE'`; entity type `SocialProvider` includes `'APPLE'` | `migrations/001_create_core_tables.sql:10`, `src/modules/user/entities/social-account.entity.ts` |
| `social_account` has `UNIQUE (provider, provider_user_id)`; token columns were **dropped** ("we never call provider APIs on the user's behalf") | `migrations/001…:188`, `migrations/030_group_a_cleanup.sql` §4 |
| Google: `OAuth2Client.verifyIdToken` with audiences `[GOOGLE_CLIENT_ID, GOOGLE_IOS_CLIENT_ID]`. **Does not check `email_verified`** | `src/modules/auth/auth.service.ts` `registerWithGoogle` |
| Facebook: Graph `debug_token` + `/me` with an access token | `auth.service.ts` `registerWithFacebook` |
| Shared flow: tx → `findOrCreateFromOAuth` → role on new user → commit → `assertSignInAllowed` → tokens. Typed `provider: 'GOOGLE' \| 'FACEBOOK'` | `auth.service.ts` `handleOAuthSignIn` |
| Linking: match by (provider, sub), else by email: refuse an **unverified** password account (`user.verifyBeforeLinking`), otherwise **auto-link silently** | `src/modules/user/user.service.ts` `findOrCreateFromOAuth` |
| Emails are not lowercased on register or lookup (`findByEmail` is an exact match) | `user.service.ts:107`, `auth/dto/register.dto.ts` |
| `linkPendingInvitations` runs on email register only, **not** on OAuth sign-up | `auth.service.ts:152` |
| `CryptoService` only hashes (SHA-256). No reversible encryption exists | `src/common/services/crypto.service.ts` |
| Deletion: 6-digit code **emailed** to `user.email`, then `schedule()` (deactivate, revoke sessions, wind down), erasure 29 days later, `DELETE FROM social_account` inside the erasure tx, Stripe calls go **before** the tx | `src/modules/account-deletion/account-deletion.service.ts`, `account-erasure.service.ts` |
| Mobile: `@capgo/capacitor-social-login@8.7.4`, Google only (`apple: false`, `facebook: false`) | `beeactive-ui/capacitor.config.ts`, `projects/mobile/src/app/pages/auth/google-sign-in.service.ts` |
| Web: Google Identity Services button; Facebook popup coded but **hidden** pending Meta review | `projects/core/src/lib/services/auth/*.ts`, `projects/web/src/app/pages/auth/_components/social-sign-in/social-sign-in.ts` |
| iOS entitlements: push + associated domains only. No Sign in with Apple. Bundle id `fit.motionhive.app` for all builds | `ios/App/App/App.entitlements`, `ios/App/App.xcodeproj/project.pbxproj` |
| No `NSUserTrackingUsageDescription` in `Info.plist`, so there is no tracking (ATT) prompt | `ios/App/App/Info.plist` |

The plugin already supports Apple on iOS (native AuthenticationServices), the web (Apple JS popup) and Android (web flow). **Use it; no new plugin.**

---

## 1. Is it required?

**Guideline 4.8 (Login Services)**, current text ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/#login-services)):

> Apps that use a third-party or social login service (such as Facebook Login, Google Sign-In, …) to set up or authenticate the user's primary account with the app must also offer as an equivalent option another login service with the following features: the login service limits data collection to the user's name and email address; the login service allows users to keep their email address private as part of setting up their account; and the login service does not collect interactions with your app for advertising purposes without consent.

- The exemption "your app exclusively uses your company's own account setup and sign-in systems" does **not** apply once Google is offered alongside email/password.
- Email/password is not the "equivalent option": it cannot keep the email private. App Review's own rejection text ends with *"Note that Sign in with Apple meets the requirements specified in guideline 4.8"* ([Apple forums, Jul 2024](https://developer.apple.com/forums/thread/760974)). In practice, Sign in with Apple is the only common option that meets all three conditions.
- The iOS app shows Google today (`GoogleSignInService.available` is true on iOS because `googleIosClientId` is set). So 4.8 applies now, before Facebook is even added.

**5.1.1(v) Account deletion:** apps that let people create an account *"must also offer account deletion within the app"*. MotionHive has this on mobile already. Apple's deletion FAQ adds: *"Apps that support Sign in with Apple should use the Sign in with Apple REST API to revoke user tokens. Use server-to-server notification endpoints to process changes"* ([Offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/)). It says "should", not "must", but plan for it. The same page says not to require email or support flows to delete, and to tell people how long it takes (we do: up to 30 days).

**Verdict:** an App Store submission with Google sign-in on iOS and no Sign in with Apple will very likely be rejected under 4.8. There are two ways through: add Sign in with Apple (recommended), or hide Google on iOS. Whether external TestFlight beta review enforces 4.8 is **(unverified)**; do not rely on TestFlight passing as a signal.

Not relevant to us: the Republic of Korea rule that Services IDs need a notification endpoint from 2026-01-01 ([Apple Developer News, 9 Oct 2025](https://developer.apple.com/news/)).

---

## 2. Setup checklist (owner)

### 2.0 Decide first: which Apple team ships the app

- [ ] Confirm whether the paid developer account is **individual** or **organization** (HIVECRAFT S.R.L.). If the app will ever move to another team, do it **before** launching Sign in with Apple. A transfer changes every user's team-scoped `sub` and private relay address, and needs a 60-day migration through `transfer_sub` and Apple's `usermigrationinfo` endpoint ([Transferring apps and users](https://developer.apple.com/documentation/signinwithapple/transferring-your-apps-and-users-to-another-team)).

### 2.1 Certificates, Identifiers & Profiles

1. [ ] **App ID** `fit.motionhive.app` → enable *Sign in with Apple* → *Enable as a primary App ID*. The `fit.motionhive.app.RestTimer` extension does not need it.
2. [ ] In the same dialog, set the **server-to-server notification endpoint**: `https://<prod API host>/webhooks/apple`. Only one URL per app group, set on the primary App ID, TLS 1.2+ ([Enabling S2S notifications](https://developer.apple.com/help/account/configure-app-capabilities/enabling-server-to-server-notifications)). The dev API will receive no notifications, and the prod endpoint will receive events for TestFlight testers' accounts. That is fine: unknown `sub` → 200.
3. [ ] **Services ID** (web + Android client), e.g. `fit.motionhive.web` → enable Sign in with Apple → primary App ID `fit.motionhive.app` → Website URLs:
   - domains `app.motionhive.fit`, `dev.app.motionhive.fit`
   - return URLs `https://app.motionhive.fit/auth/login`, `https://dev.app.motionhive.fit/auth/login` (the popup's `redirectURI`, mirroring Google's)
   - later, for Android: `https://<API host>/auth/apple/callback`
   - No verification file is needed anymore ([Configure SIWA for the web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web)). Return URLs must be https with a domain, no IP, no `localhost`, no `#` ([Token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens)). So the web flow cannot be tested on `localhost:4200`; use `dev.app.motionhive.fit` or a tunnel.
   - Limits: individuals 10 website URLs, organizations 100.
4. [ ] **Key**: Keys → + → *Sign in with Apple* → Configure with primary App ID → download the `.p8` (downloadable only once). Note the **Key ID** (10 chars) and **Team ID** (Membership page). A primary App ID can have at most **two** keys ([Configuring your environment](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple)). Recommendation: one key used by both environments, which keeps the second slot free for rotation.
5. [ ] **Private Email Relay**: Services → *Sign in with Apple for Email Communication* → Email Sources → add **`motionhive.fit`** and **`send.motionhive.fit`**, then confirm both show an SPF pass. See 2.3 for why both.
6. [ ] **Provisioning profile**: enabling a capability invalidates the App Store profile. Regenerate it for `fit.motionhive.app` and update the GitHub secret `IOS_PROVISIONING_PROFILE` (`beeactive-ui/.github/workflows/ios-testflight.yml`).

### 2.2 Xcode and Capacitor

- [ ] Xcode → target App → Signing & Capabilities → + *Sign in with Apple*. This adds the following to `ios/App/App/App.entitlements`:
  ```xml
  <key>com.apple.developer.applesignin</key>
  <array><string>Default</string></array>
  ```
- [ ] `capacitor.config.ts` → `SocialLogin.providers.apple: true`, then `npx cap sync ios` (the comment there already says a provider change needs a sync).
- [ ] Test on a real device signed in to iCloud. Native Sign in with Apple only allows the device's signed-in Apple Account; the web flow allows any Apple Account ([Authenticating users](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple)).

### 2.3 Email: what reaches `@privaterelay.appleid.com` / `@private.icloud.com`

Apple's rules ([Configure private email relay](https://developer.apple.com/help/account/configure-app-capabilities/configure-private-email-relay-service)): mail must pass SPF **or** DKIM, and the authenticated domain must be registered **exactly**. For SPF, the envelope sender (Return-Path) domain is checked. For DKIM, the `d=` domain must equal the From domain. An unregistered source is bounced. Each relay address takes at most **100 emails a day** ([Private email relay](https://developer.apple.com/documentation/signinwithapple/communicating-using-the-private-email-relay-service)).

What our DNS publishes today (checked 2026-11-07):

| Sender | From / envelope | Auth | Register |
|---|---|---|---|
| Resend (`EmailService`, `noreply@motionhive.fit`) | From `motionhive.fit`, envelope `send.motionhive.fit` | DKIM `resend._domainkey.motionhive.fit` (d=motionhive.fit); SPF on `send.` = `include:amazonses.com` | `motionhive.fit` (DKIM path) **and** `send.motionhive.fit` (SPF path) |
| Zoho (people writing from `contact@`, `ana@`) | `motionhive.fit` | SPF `include:zohomail.eu` on the apex | covered by `motionhive.fit` |
| **Stripe** (invoice sent, paid receipt, dunning, renewal, refund) | `stripe.com` | Stripe's | **cannot register `stripe.com`**: these emails will bounce for relay users. Fix: set up a [Stripe custom email domain](https://docs.stripe.com/get-started/account/email-domain) (needs DMARC, which we have at `p=none`) and register that domain with Apple. Which account sends for our Connect setup needs checking in the dashboard **(unverified)** |
| A future newsletter ESP | its own domain | its own | register its sending domain or subdomain too |

Replies from relay users come back through the relay to the address you sent from. A client's own Gmail cannot write to a coach's relay address, because only registered sources are accepted (see 4.4, public coach email).

### 2.4 Environment variables (API)

All optional in `src/config/env.validation.ts`, like Google and Facebook; missing values mean `auth.providerUnavailable`.

| Var | Example | Used for |
|---|---|---|
| `APPLE_TEAM_ID` | `ABCDE12345` | `iss` of the client secret |
| `APPLE_KEY_ID` | `XYZ987WVUT` | `kid` of the client secret |
| `APPLE_PRIVATE_KEY` | `.p8` PEM, `\n` escaped (or base64) | signs the client secret (ES256) |
| `APPLE_BUNDLE_ID` | `fit.motionhive.app` | accepted `aud`, `client_id` for native codes |
| `APPLE_SERVICES_ID` | `fit.motionhive.web` | accepted `aud`, `client_id` for web and Android codes |
| `APPLE_WEB_REDIRECT_URI` | `https://app.motionhive.fit/auth/login` | `redirect_uri` when exchanging a web code (must equal the popup's) |
| `APPLE_ANDROID_REDIRECT_URI` | `https://<API host>/auth/apple/callback` | phase 2 |
| `TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64 | AES-256-GCM for the stored Apple refresh token |

Set them on **both** Railway services: TestFlight builds talk to the dev API (`environment.mobile-staging.ts`), and the bundle id is the same. Owner sets secrets in Railway directly, never via chat.

FE environment additions: `appleServicesId`, `appleRedirectUri` in `projects/core/src/environments/*`.

---

## 3. Backend verification design

### 3.1 Flows per platform

| Platform | Client | Token `aud` / `client_id` | `redirect_uri` on code exchange | Name comes from |
|---|---|---|---|---|
| iOS app | capgo plugin → AuthenticationServices | `APPLE_BUNDLE_ID` | none | `result.profile.givenName/familyName` |
| Web app | Apple JS, `usePopup: true` (core service, like `GoogleAuthService`) | `APPLE_SERVICES_ID` | `APPLE_WEB_REDIRECT_URI` | `res.user.name`, first authorization only |
| Android (phase 2) | plugin web flow, `form_post` to the API | `APPLE_SERVICES_ID` | `APPLE_ANDROID_REDIRECT_URI` | `user` form field, first time only |

`sub` is the same for one person across all apps and Services IDs of our team, so all three land on the same `social_account` row ([id_token claims](https://developer.apple.com/documentation/signinwithapplejs/authorizationi/id_token)).

### 3.2 Verify the identity token

Per [Verifying a user](https://developer.apple.com/documentation/signinwithapple/verifying-a-user) and the [id_token reference](https://developer.apple.com/documentation/signinwithapplejs/authorizationi/id_token):

- [ ] Signature RS256 against the JWKS at `https://appleid.apple.com/auth/keys`. Select the key by `kid`, cache keys for 24 h, refetch once on an unknown `kid` (throttled to one refetch a minute, so random `kid`s cannot hammer Apple).
- [ ] `iss === 'https://appleid.apple.com'`.
- [ ] `aud` ∈ `[APPLE_BUNDLE_ID, APPLE_SERVICES_ID]`. Keep the matched `aud`: it is the `client_id` for the code exchange and for revocation.
- [ ] `exp` in the future (60 s clock tolerance).
- [ ] `nonce` (3.3).
- [ ] `sub` → `providerUserId`. Never identify by email: Apple says *"Don't use this value as an identifier of the user"*.
- [ ] `email`: may be missing (Managed Apple Accounts in Apple School Manager). Missing → existing `auth.providerNoEmail` with `{ provider: 'Apple' }`.
- [ ] `email_verified` and `is_private_email` are **string or boolean** (`"true"` / `true`): normalise both.
- [ ] Detect relay addresses by `is_private_email`, **not by domain**. Relay domains are `privaterelay.appleid.com`, `private.icloud.com` (new Sign in with Apple addresses move there "later this year", [Apple Developer News, 24 Aug 2026](https://developer.apple.com/news/)), and the relay doc also lists `icloud.com`.
- [ ] `real_user_status` (native only, 0/1/2): optional anti-fraud signal; store nothing for now.

Sketch (`src/modules/auth/apple/apple-identity.service.ts`):

```ts
const APPLE_ISSUER = 'https://appleid.apple.com';

async verifyIdentityToken(idToken: string, rawNonce: string): Promise<AppleIdentity> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded) {
    throw this.signInFailed();
  }
  const publicKey = await this.publicKeyFor(decoded.header.kid);
  const claims = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    audience: this.acceptedAudiences(),
    clockTolerance: 60,
  }) as AppleIdTokenClaims;

  const expectedNonce = createHash('sha256').update(rawNonce).digest('hex');
  if (claims.nonce !== expectedNonce) {
    throw this.signInFailed();
  }

  return {
    sub: claims.sub,
    clientId: claims.aud,
    email: claims.email ?? null,
    emailVerified: isTrueClaim(claims.email_verified),
    isPrivateEmail: isTrueClaim(claims.is_private_email),
  };
}

/** Apple's `kid` → Node KeyObject, from the cached JWKS. */
private async publicKeyFor(kid: string | undefined): Promise<KeyObject> {
  // fetch https://appleid.apple.com/auth/keys, crypto.createPublicKey({ key: jwk, format: 'jwk' })
}
```

### 3.3 Nonce (hashed nonce flow)

- The client generates a random `rawNonce` (32+ bytes), sends **`sha256hex(rawNonce)`** to Apple (`options.nonce` on the plugin; `nonce` in `AppleID.auth.init`), and sends **`rawNonce`** to the API. The API hashes it and compares with the token's `nonce`. This is the convention Firebase documents: Apple *"will pass [it] unchanged in the response"* ([Firebase, Apple on iOS](https://firebase.google.com/docs/auth/ios/apple)).
- Verified in the plugin source: iOS sets `request.nonce = payload["nonce"]` as is (`AppleProvider.swift`), and web passes `nonce` straight into `AppleID.auth.init`. So the client does the hashing on both. That Apple JS also echoes the nonce unchanged is **(unverified)**: log the comparison on the first web test.
- If a token arrives without `nonce` but with `nonce_supported: true`, fail. Apple: *"treat nonce as mandatory and fail the transaction"*.
- Replay protection also comes from the single-use authorization code (3.5).

### 3.4 Name: only once, only client-side

- Apple: *"Apple doesn't receive the user's full name shared with the system UI. The raw data is passed directly to your app … and is not included in the user's identity token."* It is returned only on the **first** authorization, and again only if the person disconnects the app and reconnects ([Receiving the identity token](https://developer.apple.com/documentation/signinwithapple/receiving-a-users-identity-token), [Authenticating users](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple)). The person can edit it in the sheet, so it can be empty or odd. Apple asks you to sanitise it.
- The client forwards `firstName` / `lastName` in the same `POST /auth/apple`. The API trims, runs `stripHtml` (`common/utils/text.utils.ts`), caps at 100 (column size) and uses them when creating the user.
- **If the first call fails** (network, API down):
  - iOS: recoverable. The plugin caches the name in `UserDefaults` keyed by the Apple user id and fills it on later logins (`persistName` / `retrieveName` in `AppleProvider.swift`), so the retry still carries it. On account deletion call `SocialLogin.logout({ provider: 'apple', clearCachedUserInfo: true })`.
  - Web / Android: not recoverable by Apple. The FE must keep the name in `sessionStorage` until the API answers 2xx, then clear it.
  - API: if the account exists and still has the placeholder name (`createFromOAuth` uses `'User'` / `''` today) and the request carries a name, set it. Otherwise the name is never overwritten.
  - Last resort: the account is created with the placeholder and onboarding asks "What should we call you?". That is allowed, because Apple did not give a name. Return a flag such as `needsName: true` in the auth response so onboarding does not have to guess from the placeholder.

### 3.5 Code exchange, refresh token, revocation

- The authorization code is *"single-use only and valid for five minutes"*. `POST https://appleid.apple.com/auth/token` with `client_id` (= the token's `aud`), `client_secret`, `code`, `grant_type=authorization_code`, and `redirect_uri` **only** for web or Android codes. The response has `refresh_token` and `id_token` ([Token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens)).
- **Client secret**: a JWT signed ES256 with the `.p8`. Header `kid` = Key ID. Claims: `iss` = Team ID, `iat`, `exp` (≤ 6 months; use 5 minutes), `aud` = `https://appleid.apple.com`, `sub` = the same `client_id` ([Creating a client secret](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret)).
  ```ts
  private clientSecret(clientId: string): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { iss: this.teamId, iat: now, exp: now + 300, aud: APPLE_ISSUER, sub: clientId },
      this.privateKey,
      { algorithm: 'ES256', keyid: this.keyId },
    );
  }
  ```
- Order, following the house rule for Stripe: **verify the token, then exchange the code (HTTP) outside any transaction**, then open the sign-in tx and store the result.
  - Network error or 5xx from Apple: still sign the person in, log a warning, and retry the exchange on their next Apple sign-in.
  - `invalid_grant` (replayed or expired code): reject with `auth.providerSignInFailed`.
  - Check that the `id_token` from the exchange carries the same `sub`.
- **Store the newest refresh token on every Apple sign-in**, encrypted (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`), together with `token_client_id`. A refresh token is invalidated by e.g. an Apple Account password change ([Verifying a user](https://developer.apple.com/documentation/signinwithapple/verifying-a-user)), so rotating keeps it usable.
- **Revoke**: `POST https://appleid.apple.com/auth/revoke` with `client_id` (must match the one the token was issued to), `client_secret`, `token`, `token_type_hint=refresh_token`. It returns 200 *"after the server invalidates the token value, or if the token value was previously invalidated"*, so retries are safe ([Token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens)).
- **Why store a token when migration 030 dropped them:** revocation is a concrete use, and storing covers every deletion path: in-app confirm, the admin "emailed request" path and the erasure sweep. Write that reason into the migration comment.
  - The alternative is Firebase's model: store nothing, and at deletion ask the person to sign in with Apple again, then exchange that fresh code and revoke at once ([Firebase](https://firebase.google.com/docs/auth/ios/apple)). It keeps 030's stance, but the admin path and Android/web deletions could then never revoke.
  - Recommendation: store, encrypted. Also offer the re-auth as a deletion **proof** (see 4.4).

**Where revoke hooks in:**

| Hook | File | When | On failure |
|---|---|---|---|
| `schedule()` after commit (covers app confirm **and** admin `scheduleOnRequest`) | `account-deletion.service.ts` | immediately, so the person's Apple settings reflect it | log; erasure retries |
| `erase()` before the tx, next to `deleteStripeCustomers` | `account-erasure.service.ts` | erasure day; must run **before** `ERASURE_STATEMENTS` deletes `social_account` | log and continue: never block a GDPR deadline on Apple |
| Unlink Apple in settings | new | on unlink | log |
| `consent-revoked` / `account-deleted` notification | new | token already dead; just delete it | n/a |

Restore during the cooling-off still works: signing in with Apple again gives the same `sub` (Apple: it *"doesn't change if the user stops using Sign in with Apple with your app and later starts using it again"*) and a fresh refresh token.

### 3.6 Server-to-server notifications

`POST /webhooks/apple`, `@Public()`, JSON body `{ "payload": "<JWT>" }`, signed by Apple. Verify it with the same JWKS, `iss` and `aud` checks, no nonce ([Processing changes](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts)). The `events` claim is documented as an object. Implementations commonly receive it as a JSON string, so **handle both (unverified)**. Note the event name is **`account-deleted`**, not `account-delete`.

| `events.type` | Meaning | What MotionHive does |
|---|---|---|
| `email-disabled` | Person turned off forwarding to their relay address | set `social_account.email_forwarding_off_at`; mail to that address now bounces. Deletion offers Apple re-auth instead of the emailed code (4.4). Later: skip non-essential sends |
| `email-enabled` | Forwarding back on | clear `email_forwarding_off_at` |
| `consent-revoked` | Person removed MotionHive from their Apple Account; *"their credentials become invalid"* | delete the stored refresh token; revoke MotionHive refresh tokens (sign out everywhere, like `schedule()` does); **keep** the `social_account` row so a later Apple sign-in maps back to the same account |
| `account-deleted` | Apple Account permanently deleted; all tokens invalid, forwarding off | as above, plus delete the Apple `social_account` row. If the user has **no other sign-in method** (no password, no other provider), the account is unreachable: flag it for admin, or schedule deletion through the existing path (**owner decision**) |

- Answer 200 for an unknown `sub`, 400 for a bad signature.
- Handlers are idempotent (set or clear a field), so no dedup table is needed; log the `jti`.
- Mirror the module layout of `payment-webhook.controller.ts`, but with no raw body: the JSON parser is fine here.

### 3.7 Library choice

- Google uses `google-auth-library`, which is Google-specific and cannot verify Apple tokens.
- `jose@6` (present transitively) is **ESM-only** (`"type": "module"`), while the API compiles to CommonJS. `.node-version` pins Node **20**, and `require(esm)` only works without a flag from 20.19 / 22.12. ts-jest adds its own ESM friction. Avoid it. (Aside: `firebase-admin@14` declares `node >= 22`, which disagrees with `.node-version`; worth checking what Railway actually runs.)
- **Recommendation: no new dependency.** Use Node's `crypto.createPublicKey({ key: jwk, format: 'jwk' })` for the JWKS, `fetch` for Apple's endpoints, and `jsonwebtoken` for verify (RS256) and sign (ES256). It is already installed as `@nestjs/jwt`'s dependency (9.0.3); add it to `package.json` explicitly, pinned.
- The same helper verifies Facebook Limited Login tokens (section 5).

---

## 4. Clashes and duplicate accounts

### 4.1 Where duplicates and mismatches come from

| Case | Today's behaviour once Apple is added | Effect |
|---|---|---|
| Has Google or email account `ana@gmail.com`, signs in with Apple and picks **Hide My Email** | relay address matches nothing → new account | **duplicate, empty account**; the most common case |
| Shares the **real** email with Apple, and it matches a verified or OAuth-only account | auto-linked silently | fine (Apple verified the email), but no notice to the owner |
| Real email matches an **unverified** password account | 409 `user.verifyBeforeLinking` | correct refusal (pre-registration takeover); dead end in UX |
| Same email, different case (`Ana@` vs `ana@`) | `findByEmail` is exact | duplicate; affects Google today too |
| Person disconnects the app in Apple settings and reconnects, picking a different email option | `sub` unchanged → same account | email in token differs; must not create anything new |
| Apple Account email changes | `sub` unchanged | match by `sub` only; update `provider_email` |
| App transferred to another Apple team | **new `sub` and new relay address** | everyone looks new; avoid (2.0) or migrate via `transfer_sub` within 60 days |
| iOS (bundle id) and web (Services ID) sign-ins | same `sub` | same row; but the refresh token belongs to one `client_id`, so store it |

Apple's own advice ([Authenticating users](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple)): *"For new accounts that use Sign in with Apple, let the user know that they're creating a new account, and ask if they have any existing accounts to link to."* The HIG adds: *"If people share an email address through Sign in with Apple and it matches the address in an existing account, you can suggest that they link"*, and suggests offering linking in account settings ([HIG](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple)).

### 4.2 Recommended linking policy

1. **Identity is (provider, sub).** Email is a hint, never an identifier.
2. **Auto-link by email only when the provider vouches for it:** Google with `email_verified === true` (add the check, it is missing today), Apple with `email_verified` true **and** `is_private_email` false. **Never for Facebook**: its email has no `email_verified` claim, a point both the plugin docs and Meta's token docs make (section 5). Keep the existing rule for unverified password accounts.
3. **Every link sends a security notice**: an email (EN + RO, `catalog/{en,ro}/email/auth.ts`, sample in `test/fixtures/email-samples.ts`) plus an in-app notification. Something like: "You can now sign in with Apple. Not you? Remove it in Settings and contact us." This is the cheap fix for the "auto-link without consent" weakness.
4. **New relay account: create it at once** (one tap, no interstitial). Then, on the first onboarding screen, show a quiet line: "Already have a MotionHive account? Link it instead." That opens sign-in with the other method. If the new account is still empty (no coach profile, no clients, groups, logs or payments, created in the last few days), move the Apple `social_account` row onto the existing account and close the empty one. Refuse otherwise, and point to support. Never build a general account merge.
5. **Settings → Sign-in methods** (mobile + web): lists linked methods ("Signed in with Apple · xy@privaterelay.appleid.com", which the HIG asks you to show), "Connect Apple / Google" while signed in, "Remove" only if another method remains (password or another provider), with a revoke on removal. This is how existing users add Apple without creating a duplicate.
6. **Login screen hint**: remember the last-used method on the device ("Last time you used Google"). It is cheap and prevents most duplicates.
7. **Normalise emails** to lowercase on every write and lookup (register, OAuth, invites, `findByEmail`). Check for existing case-duplicates before adding a unique index on `lower(email)`.
8. **Email changes at Apple**: never re-link on them. Update `social_account.provider_email`. Update `user.email` only when it equals the old Apple email (it came from Apple) and no other account holds the new one.

### 4.3 Does Apple change the auto-link risk?

- Not for account takeover. Apple verifies the email it shares, and relay addresses are unique to our team, so they cannot collide with someone else's account. The risk class equals Google's.
- The weakness grows with **Facebook** (no `email_verified`) and exists for Google today (claim not checked). Points 2 and 3 above close most of it.
- Apple's real new risk is **duplicates**, not takeover.
- Optional hardening for the unverified-password case: instead of the 409, link Apple and **drop the unverified password** (null `password_hash`, mark verified, revoke sessions). The person proved the inbox; whoever set the password did not. This is the standard defence against pre-registration takeover. It is a judgement call, so the 409 can stay for now.

### 4.4 Relay side-effects elsewhere in this codebase

| Area | File | Problem with a relay email | Fix |
|---|---|---|---|
| Group invitations | `src/modules/invitation/invitation.service.ts` `accept` / `decline` | require `invitation.email === user.email` → `invitation.wrongEmail` for a relay user, who **can never accept** an emailed group invite | accept on token possession (as client invites already do via `acceptByToken`), or also match any linked `provider_email` |
| Pending client invites by email | `auth.service.ts` `linkPendingInvitations` | not called for OAuth sign-ups at all (Google too); relay never matches anyway | call it for new OAuth users; client invite links use the token, which already works |
| Guest Stripe customers | `auth.service.ts` `linkGuestStripeCustomers` | invoices sent to a real address before sign-up won't link to a relay account | accept; covered by Settings linking or support |
| Coach public profile | `src/modules/profile/profile.service.ts` (`showEmail` default **true**) | public profile shows a relay address; clients' mail to it bounces (unregistered source) | hide relay addresses on public profiles; suggest a public contact email |
| **Account deletion code** | `account-deletion.service.ts` `sendCode` | if forwarding is off (`email-disabled`), the code never arrives → no in-app deletion → **5.1.1(v) and GDPR risk** | for Apple-linked accounts, accept a fresh Apple sign-in (verified `sub` match) as the proof instead of the code |
| Stripe emails | Stripe dashboard | come from `stripe.com` → bounce | Stripe custom email domain + register with Apple (2.3) |
| Password reset | `auth.service.ts` `forgotPassword` | works for OAuth-only users if forwarding is on, but the person must know their relay address | show it in Settings (HIG); this is also the Android fallback until phase 2 |

---

## 5. Facebook on iOS: Limited Login breaks `POST /auth/facebook`

**What Meta says** ([Limited Login FAQ](https://developers.facebook.com/docs/facebook-login/limited-login/faq), [Limited Login](https://developers.facebook.com/docs/facebook-login/limited-login/)):

- *"When users opt out of ATT, all Facebook Login traffic will be performed on the Limited Login domain"*, and *"the SDK no longer provides valid user access tokens in scenarios where the user opts out of ATT."* *"A graph request will fail because there is no access token."*
- Limited Login *"returns an AuthenticationToken that wraps an OpenID Connect token"*, which *"cannot be used to request additional data using the Graph API."*
- Community reports and SDK maintainers say "not determined" (never asked) is treated like a decline ([facebook-ios-sdk issues](https://github.com/facebook/facebook-ios-sdk/issues/2365)) **(not in Meta's own docs)**.

**In our code:**

- Web uses the OAuth popup with `response_type=token`, which returns a classic Graph token. Unaffected.
- Mobile has no Facebook today (`facebook: false`). Once it is enabled through the capgo plugin, the plugin returns `accessToken: null` plus `idToken` when Limited (`FacebookProvider.swift`: *"Only the absence of a Graph access token identifies a Limited Login session, including when Facebook forces limited because ATT was not granted"*).
- The app has **no ATT prompt** (no `NSUserTrackingUsageDescription`), so on iOS **every** Facebook login will be Limited. `registerWithFacebook` requires an access token, so it will fail for every iOS user.
- Adding an ATT prompt only to get classic login is a bad trade: it makes us a "tracking" app in the privacy labels, features cannot be gated on it (5.1.2(i)), and people who decline are still Limited.

**What the API needs** before Facebook ships on iOS:

- [ ] `FacebookAuthDto`: accept **either** `accessToken` (web, Android) **or** `idToken` + `rawNonce` (iOS).
- [ ] Verify the JWT like Apple's: RS256 via JWKS `https://limited.facebook.com/.well-known/oauth/openid/jwks/` ([token docs](https://developers.facebook.com/docs/facebook-login/limited-login/token)). The discovery document at `https://limited.facebook.com/.well-known/openid-configuration/` reports `issuer: https://www.facebook.com` and `jwks_uri: https://www.facebook.com/.well-known/oauth/openid/jwks/`, so accept `iss` ∈ {`https://www.facebook.com`, `https://limited.facebook.com`}. Also `aud === FACEBOOK_APP_ID`, `exp`, and `nonce` ([validating](https://developers.facebook.com/docs/facebook-login/limited-login/token/validating)).
- [ ] Claims available: `sub`, `name`, `given_name`, `family_name`, `email`, `picture` (from discovery `claims_supported`).
- [ ] `sub` should be the app-scoped user id, the same as Graph `/me` `id`, so it hits the existing `social_account` row. The FAQ says the ASID *"remains available in Limited Login mode"*. **Verify with one test account (unverified).**
- [ ] Always pass a real nonce: the plugin defaults it to `"123"`.
- [ ] No `email_verified` → never auto-link by Facebook email (4.2).

---

## 6. Sign-up experience: auth-side constraints for onboarding

From the [HIG](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple):

- [ ] **Button:** *"no smaller than other sign-in buttons, and avoid making people scroll to see the button."* Put Apple first on iOS, the same width and height as Google.
  - On mobile it will be a custom `ion-button`, which the HIG allows. Use Apple's downloadable logo artwork only, logo and title both black or both white, rectangular. Titles must be exactly *Sign in / Sign up / Continue with Apple*. Use **"Continue with Apple"** to match "Continue with Google".
  - Black on light, white on dark (light is our primary theme). App Review checks custom buttons.
  - Romanian label: take the exact string Apple JS renders with the `ro_RO` locale **(unverified)**, in both EN and RO catalogs.
- [ ] **One tap:** no screen between the tap and Apple's sheet. After success go straight into the app. *"Don't delay the experience by asking for information that isn't required."*
- [ ] **Never re-ask** for the name or email Apple gave. *"Avoid asking for a personal email address when people supply a private relay address."* *"Don't ask people to supply a password."* Setting one later through reset stays optional.
- [ ] **Missing name** (3.4): asking is fine, with the reason (coaches and clients see it).
- [ ] **Collect after auth, not during:** interests, role (coach or trainee), city, push permission and marketing consent go in onboarding or later, each marked required or optional. The HIG: *"Clarify whether the additional data you request is required or just recommended."*
- [ ] **Welcome with what was shared**, which also shows a relay user their address. Show "Using Sign in with Apple" in Settings.
- [ ] Pass `language` like Google does; keep client invite tokens across the Apple sheet (already token-based).

---

## 7. Data, consent and future brand deals

**What Sign in with Apple gives us:** `sub`, name (once), email (real or relay), `email_verified`, `is_private_email`, and on native `real_user_status`. Nothing about age, gender or interests. Google and Facebook basic scopes give about the same (Facebook can add more with extra permissions and Meta review).

**Apple rules that matter** ([Guidelines 5.1.2](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing), [User privacy and data use](https://developer.apple.com/app-store/user-privacy-and-data-use/)):

- 5.1.2(i): permission before using or sharing personal data. *"Data collected from apps may only be shared with third parties to improve the app or serve advertising."* Features cannot be gated on tracking consent.
- 5.1.2(ii): *"Data collected for one purpose may not be repurposed without further consent."*
- **ATT applies only to "tracking"**: *"linking user or device data collected from your app with user or device data collected from other companies' apps, websites, or offline properties for targeted advertising or advertising measurement … [or] sharing user or device data with data brokers."*
  - Segmenting our own users on our own servers by what they told us and did in MotionHive is **not tracking**, so no ATT. Apple's page has no explicit "first-party" exception; this follows from the definition.
  - It **becomes** tracking if we upload email lists or hashed emails to Meta or Google custom audiences, give a brand user-level data for their ad targeting, or add an ad or attribution SDK.

**Brand partnerships, a safe pattern:**

- MotionHive itself delivers partner offers (in-app, push, email) to people who opted in. Brands get **aggregate** results only; no user-level data leaves us.
- If a brand wants leads, ask per brand at the moment of the offer ("Share my name and email with X"), unticked, and record it.

**GDPR / ePrivacy (EU, Romania):**

- Marketing email and push need prior opt-in consent, except the soft opt-in for our own similar products to existing users with an easy opt-out (ePrivacy Directive art. 13, [EUR-Lex](https://eur-lex.europa.eu/eli/dir/2002/58/oj); Romanian Legea 506/2004 art. 12). The Romanian specifics are **(not re-checked; confirm with counsel)**.
- Profiling for marketing must be disclosed in the privacy policy and can be objected to (GDPR art. 21).
- Consent must be separate from the terms, granular (MotionHive news / partner offers / marketing push), unticked by default, and as easy to withdraw as to give. Record purpose, time, policy version and source; the `payment_consent` table is a pattern to copy.
- **When to ask:** never on the sign-in screen. Ask after onboarding or after the first value moment, and partner sharing only at offer time.

**Relay addresses and marketing:**

- Allowed: Apple forwards mail from registered sources.
- A newsletter ESP needs its domain registered with SPF/DKIM (2.3).
- Honour `email-disabled` (stop sending; it would bounce anyway and hurt sender reputation).
- Mind the 100 emails a day per relay address.
- Update the privacy policy and the App Store privacy labels **before** partner offers start, not after.

Google and Meta terms also forbid selling or transferring data from their login (Google API Services User Data Policy; Meta Platform Terms). The exact clauses are **(not reviewed here)**.

---

## 8. Implementation plan

Sizes: **S** ≤ half a day, **M** about 1 day, **L** 2 to 3 days. Steps 2 to 7 and 9 are the minimum for App Review.

| # | Step | Size | Notes |
|---|---|---|---|
| 0 | Owner setup (section 2) | S (owner) | team decision first; regenerate the provisioning profile |
| 1 | Pre-fixes that also help Google: lowercase emails (+ duplicate check, then a `lower(email)` unique index), Google `email_verified` check, `linkPendingInvitations` for new OAuth users, hide relay emails on public coach profiles | M | independent of Apple; ship first |
| 2 | Migration `081_sign_in_with_apple.sql` + `SocialAccount` entity fields | S | see below; **no enum change needed** |
| 3 | `CryptoService.encrypt/decrypt` (AES-256-GCM, random IV, auth tag) + `TOKEN_ENCRYPTION_KEY` in Joi + spec | S | |
| 4 | `AppleIdentityService` (JWKS cache, verify, client secret, exchange, revoke) in `src/modules/auth/apple/` + spec | M | `jsonwebtoken` pinned as a direct dependency |
| 5 | `AppleAuthDto` + `POST /auth/apple` (`@Throttle` 10 / 15 min like Google) + `AuthService.registerWithApple`; widen `handleOAuthSignIn` to `SocialProvider`; store token and `is_private_email` in the sign-in tx; add `isNewUser` / `needsName` to the response; `AuthDocs.apple` in `src/common/docs/auth.docs.ts` | M | exchange the code before the tx |
| 6 | Revoke hooks in `schedule()` (after commit) and `erase()` (before the tx) + spec updates | S | never blocks erasure |
| 7 | `POST /webhooks/apple` controller + `AppleNotificationService` (4 events) + spec | M | |
| 8 | Linking: security email + in-app notice on every link (EN + RO + samples), `GET /users/me/sign-in-methods`, `POST /auth/link/:provider`, `DELETE /users/me/sign-in-methods/:provider` (refuse the last one) | L | |
| 9 | Mobile iOS: `apple: true` + sync + entitlement; `AppleSignInService` next to `google-sign-in.service.ts` (nonce, sha256, `useProperTokenExchange: true` to get `authorizationCode`, forward name); button in `pages/auth/_components/social-sign-in`; `clearCachedUserInfo` in `main/account/delete-account`; EN + RO strings; device test | M | |
| 10 | Web: core `AppleAuthService` (load Apple JS with the page's locale, popup, nonce) + button in web `social-sign-in`; name kept in `sessionStorage` until 2xx | M | |
| 11 | Settings UI for sign-in methods (mobile + web), relay address shown | M | |
| 12 | Deletion proof by Apple re-auth when forwarding is off (`account-deletion` + mobile screen) | M | after step 7 |
| 13 | Group invitations: accept on token possession for relay users | S | |
| 14 | Facebook Limited Login (`idToken` path in `registerWithFacebook`) | M | **before** enabling Facebook on iOS |
| 15 | "Link instead" for brand-new empty relay accounts (4.2 point 4) | L | after 8 |
| 16 | Android Apple: `POST /auth/apple/callback` (`form_post`: `code`, `id_token`, `state`, `user`) verifies, completes sign-in server-side, and returns to the app via App Link with a short one-time ticket (like the restore ticket); never put the client secret or tokens in the URL | L | phase 2; until then, Android relay users use password reset |

**Migration 081 (sketch):**

```sql
-- 081_sign_in_with_apple.sql
-- APPLE already exists in enum_social_provider (001). 030 dropped provider
-- tokens because nothing read them; Apple's refresh token is the exception:
-- it is what revokes Sign in with Apple when an account is deleted. Stored
-- encrypted (AES-256-GCM, TOKEN_ENCRYPTION_KEY), never exported.
BEGIN;
ALTER TABLE social_account
  ADD COLUMN IF NOT EXISTS refresh_token_enc       TEXT NULL,
  ADD COLUMN IF NOT EXISTS token_client_id         VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS is_private_email        BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS email_forwarding_off_at TIMESTAMPTZ NULL;
COMMIT;
```

Use TIMESTAMPTZ: the local TIMESTAMP shift trap noted for `account_deletion` applies here too. The GDPR export already selects only `provider, providerEmail, createdAt` (`user.service.ts`). Keep it that way and add a test.

**DTO (sketch, `src/modules/auth/dto/apple-auth.dto.ts`):** `identityToken` (string, required), `rawNonce` (string, 32 to 128), `authorizationCode?`, `firstName?` / `lastName?` (max 100), `language?` (`SUPPORTED_LOCALES`, as in Google's DTO). Validation messages a person can hit are catalog keys.

**i18n keys** (both `src/common/i18n/catalog/en/…` and `…/ro/…`; English defines the type, so a missing RO key fails the build):

| Key | File | Use |
|---|---|---|
| reuse `auth.providerUnavailable` / `providerSignInFailed` / `providerNoEmail` with `{ provider: 'Apple' }` | `errors/auth.ts` | all Apple sign-in failures (don't leak which check failed) |
| `auth.providerLinkedElsewhere` `{provider}` | `errors/auth.ts` | connecting an Apple ID already linked to another account |
| `auth.lastSignInMethod` | `errors/auth.ts` | refuse removing the only way in |
| `auth.providerNotLinked` `{provider}` | `errors/auth.ts` | unlink of a method that isn't there |
| `account.reauthMismatch` | `errors/account.ts` | deletion re-auth with a different Apple ID |
| `signInMethodAdded.*` (subject, heading, body, cta) | `email/auth.ts` | security notice; sample in `test/fixtures/email-samples.ts` |
| notification builder `auth.signInMethodAdded` | `notifications` + `test/fixtures/notification-samples.ts` | in-app copy of the same notice |

FE strings (`auth.common.continueWithApple`, sign-in methods screen) go in EN + RO in the same change (`beeactive-ui/CLAUDE.md`).

**Tests:**

- `apple-identity.service.spec.ts`: a locally generated RSA key served as a fake JWKS. Cover valid, wrong `iss`, wrong `aud`, expired, nonce mismatch, string vs boolean claims, unknown `kid` refetching exactly once, and the client secret's header and claims (ES256 key generated in the test).
- `auth.service.spec.ts`: new Apple user with name; returning user by `sub`; relay never links by email; verified real email links and sends the notice; exchange 5xx tolerated; `invalid_grant` rejected; placeholder name filled on retry.
- `account-deletion.service.spec.ts`, erasure: revoke called before the erasure tx; failure logged, not thrown.
- Notification controller spec: each of the 4 events, bad signature → 400, unknown `sub` → 200.
- Export spec: no token fields.
- FE: `AppleSignInService` hashes the nonce and forwards the name; social-sign-in renders Apple first on iOS.

---

## 9. Open questions for the owner

Answered 2026-11-07:
- **Team: HIVECRAFT S.R.L.** (the team that already ships TestFlight builds; the Xcode project signs both targets with team `AB34A8FY5K`). No transfer planned, so the `sub` migration risk in 2.0 is closed.
- **Platforms, revised 2026-11-08: iOS and the web app.** The owner widened it: the web button is built (step 10) with the Services ID `fit.motionhive.web`, so 2.1 step 3 applies again. Android (step 16) is still not built. Status and setup: `APPLE_SIGN_IN_IOS_PLAN.md`.
- ~~**Platforms: iOS only.**~~ (7 Nov, superseded) No web button, no Android, so steps 10 and 16 drop, and so do the Services ID, return URLs and domain verification in 2.1. The only accepted audience is the bundle id `fit.motionhive.app`. Consequence: an Apple user who opens the web app or an Android phone signs in there with a password set through "Forgot password" (sent to their relay address, so relay email registration in 2.3 is **required**, not optional), or with Google once they connect it in Sign-in methods.

Still open:
2. `account-deleted` for an Apple-only account: auto-schedule deletion, or flag for admin? (3.6)
4. Unverified password account with the same email: keep the 409, or link and drop the unverified password? (4.3)
5. Stripe custom email domain: worth setting up now, so relay users get invoices?

---

## Sources

Apple
- [App Review Guidelines (4.8, 5.1.1, 5.1.2)](https://developer.apple.com/app-store/review/guidelines/)
- [App Review 4.8 rejection text, forums, Jul 2024](https://developer.apple.com/forums/thread/760974)
- [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Authenticating users with Sign in with Apple](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple)
- [Receiving a user's identity token](https://developer.apple.com/documentation/signinwithapple/receiving-a-users-identity-token)
- [id_token claims](https://developer.apple.com/documentation/signinwithapplejs/authorizationi/id_token)
- [Verifying a user](https://developer.apple.com/documentation/signinwithapple/verifying-a-user)
- [Token validation (`/auth/token`)](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens)
- [Token revocation (`/auth/revoke`)](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens)
- [Creating a client secret](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret)
- [Processing changes (server-to-server notifications)](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts)
- [Communicating using the private email relay service](https://developer.apple.com/documentation/signinwithapple/communicating-using-the-private-email-relay-service)
- [Configuring your environment](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple)
- [Configuring your webpage (Apple JS)](https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple)
- [Transferring apps and users to another team](https://developer.apple.com/documentation/signinwithapple/transferring-your-apps-and-users-to-another-team)
- [Configure private email relay](https://developer.apple.com/help/account/configure-app-capabilities/configure-private-email-relay-service)
- [Configure Sign in with Apple for the web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web)
- [Enabling server-to-server notifications](https://developer.apple.com/help/account/configure-app-capabilities/enabling-server-to-server-notifications)
- [Apple Developer News](https://developer.apple.com/news/) ("Update: New domain for Sign in with Apple", 24 Aug 2026; Korea S2S requirement, 9 Oct 2025)
- [HIG: Sign in with Apple](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple)
- [User privacy and data use (ATT)](https://developer.apple.com/app-store/user-privacy-and-data-use/)

Meta
- [Limited Login](https://developers.facebook.com/docs/facebook-login/limited-login/)
- [Limited Login FAQ](https://developers.facebook.com/docs/facebook-login/limited-login/faq)
- [Limited Login OIDC token](https://developers.facebook.com/docs/facebook-login/limited-login/token)
- [Validating the token](https://developers.facebook.com/docs/facebook-login/limited-login/token/validating)
- [OIDC discovery](https://limited.facebook.com/.well-known/openid-configuration/)
- [SDK issue on ATT → Limited](https://github.com/facebook/facebook-ios-sdk/issues/2365)

Other
- [Firebase: Apple on iOS (hashed nonce, re-auth to revoke)](https://firebase.google.com/docs/auth/ios/apple)
- [Stripe custom email domain](https://docs.stripe.com/get-started/account/email-domain)
- [ePrivacy Directive 2002/58/EC](https://eur-lex.europa.eu/eli/dir/2002/58/oj)
- Plugin source: `beeactive-ui/node_modules/@capgo/capacitor-social-login` (`ios/Sources/*/AppleProvider.swift`, `FacebookProvider.swift`, `dist/esm/apple-provider.js`, `definitions.d.ts`)
