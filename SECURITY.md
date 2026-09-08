# Security

Traivr is designed around SOC 2-aligned controls. **We do not hold SOC 2
certification** — marketing copy intentionally says "designed for SOC 2
readiness," never "SOC 2 certified." Do not change that language without
legal/compliance sign-off.

## Implemented

- **Password hashing** — bcrypt (`bcryptjs`, 12 rounds) via `lib/auth`.
- **Server-side authorization** — see `PERMISSIONS.md`. Middleware gates
  surfaces; `can()`/`assertCan()` gates actions; UI conditionals are never
  the only check.
- **Session handling** — JWT sessions (Auth.js v5), 8-hour max age, secure
  cookies in production (Auth.js default), `AUTH_SECRET`-signed.
- **Account lockout** — 5 failed logins locks the account for 15 minutes
  (`User.failedLoginCount` / `lockedUntil`, checked in `lib/auth/index.ts`).
- **Password reset tokens** — single-use, 30-minute expiry
  (`User.passwordResetToken` / `passwordResetExpiresAt`), and the
  forgot-password flow never reveals whether an email is registered.
- **Email verification enforced** — accounts are created `PENDING` and cannot
  sign in until a single-use, 24-hour token is confirmed. The resend endpoint
  always reports success so it can't be used to enumerate registered emails.
- **Consent logging** — `ConsentRecord` written on registration, and again
  (separately) before any biometric identity verification begins.
- **Multi-tenant isolation** — client data is scoped to `Organization`; see
  `PERMISSIONS.md` for the enforcement point.
- **Input validation** — Zod schemas on every server action/form boundary.

## Biometric identity verification — privacy boundary

Identity verification runs through a vendor (`src/lib/identity/`), and the
platform stores **decisions only**: pass/fail per check, a provider reference
id, the document's country, and a match score. It never stores document
images, selfies, face embeddings, or biometric templates. Those remain inside
the vendor's compliance envelope.

This is deliberate and load-bearing. Biometric identifiers are special
category data under GDPR Art. 9, and Illinois BIPA attaches statutory damages
per violation with no proof of harm required. Persisting templates here would
pull the platform into obligations it is not built to carry.

**Do not add image, template, or embedding columns to
`IdentityVerification`.** If a future feature seems to need them, that is a
signal to push the work to the vendor instead.

### Manual-review path — the one disclosed exception

When no vendor is configured, trainers may instead submit to **manual,
human review**: an ID photo and a selfie uploaded directly
(`src/server/services/manual-identity-verification.ts`), stored in private
S3-compatible object storage (`src/lib/storage/s3.ts`) via `FileAsset` rows
referenced from `IdentityVerification.documentAssetId` /
`.selfieAssetId` — never inline columns on `IdentityVerification` itself,
and never a public URL; only short-lived signed URLs generated per admin
page view.

This is a real, disclosed reversal of "decisions only" for this one path,
not an oversight — the trade a platform makes when it wants a **free**
verification option instead of paying a vendor. It carries real weaknesses
a certified vendor doesn't have: no liveness/anti-spoof detection (a human
just looks at two photos), and it brings the platform into GDPR Art. 9 /
BIPA scope for as long as the images exist. Two things bound that exposure:

- **Retention is "until reviewed," never indefinite.**
  `reviewVerification()` deletes both the storage objects and their
  `FileAsset` rows the instant a decision (approve or reject) is recorded —
  see the function's doc comment in
  `src/server/services/identity-verification.ts`.
- **Trainers are told this in plain language before uploading** —
  `ManualVerificationUpload` (`src/components/trainer/verification-panel.tsx`)
  states images are stored only until reviewed, then deleted, and that
  there's no automated liveness check.

Treat this as a bridge to a real vendor, not a permanent replacement — the
gap it leaves (no anti-spoof detection) is exactly what iBeta/ISO 30107-3
Level 2 certification exists to close.

Additional requirements when going live with a vendor:

- Choose a vendor certified for **iBeta / ISO 30107-3 Level 2** presentation-
  attack detection — passive-only liveness is defeatable by replay and
  camera-injection attacks.
- Collect explicit, separately-recorded consent before capture (implemented:
  `startVerification` writes a `biometric_identity_verification` consent row).
- Publish a retention schedule, and offer a non-biometric fallback for users
  who decline or are in jurisdictions where collection isn't lawful.
- Run a DPIA before processing EU subjects.

A duplicate-identity (1:N) hit raises a `RiskFlag` for human review — it never
auto-bans, consistent with the platform's rule that serious enforcement
requires a person.

## Work location — privacy boundary

Location handling (`src/lib/security/geolocation.ts`,
`src/server/services/work-location.ts`) is deliberately **coarse and
event-driven**, not continuous tracking:

- Country/region/city from IP only — no GPS, no device location.
- Raw IPs are never persisted; only a keyed hash, so repeat visits can be
  correlated without retaining the address.
- Signals are recorded on sign-in and submission, not on a timer.
- Enforcement is **per project** (`ProjectJurisdictionRule`) — "this project
  requires workers in X" — rather than per person.
- Failing a jurisdiction check blocks assignment and is reviewable; it does
  not penalise the user, because corporate VPNs and legitimate travel both
  trip these rules.

Continuous location monitoring of remote knowledge workers would likely fail
GDPR's necessity and proportionality tests, and catches little that the
signals above miss. Raising precision is a decision that needs legal review,
not just a code change.

## API keys

Keys authenticate the versioned client API (`/api/v1/*`, see `API.md`).

- **Hashed at rest with SHA-256, not bcrypt.** That is deliberate and only
  correct because the secret is a 32-byte value we generate ourselves: there
  is no dictionary to attack, so bcrypt's slow-hash property buys nothing
  while costing a KDF round on every request. `src/lib/api/keys.ts` carries
  the same warning. Never reuse that module for passwords.
- The plaintext is returned exactly once, in the response that creates it,
  and is never stored or re-rendered.
- The non-secret `prefix` is what appears in the UI and in audit metadata.
  A full key never reaches a log line.
- Scope (`READ` / `READ + WRITE`), revocation, and expiry are all enforced
  server-side per request. Revoked, expired, and nonexistent keys produce an
  identical `401`, so a caller cannot probe which one it holds.
- Request bodies are capped at 2 MB, measured on bytes actually read rather
  than on `content-length` — that header is caller-supplied and simply absent
  on a chunked request, so a header check alone was skippable.
- The organization is resolved from the key. A caller-supplied
  `organizationId` is ignored — verified by driving both tenants' keys
  against each other's projects, datasets, and submissions.
- Issuance and revocation require organization-admin membership, are capped
  at 10 active keys per organization, and are written to the audit log.

## Single sign-on (OIDC)

Configured per organization in the client portal under Security.

**Domain ownership is proved, not asserted.** Binding an email domain to an
organization decides who gets signed into which tenant, so a tenant that
could simply claim a domain would be able to capture other people's
sign-ins. Two controls:

- Shared consumer domains (`gmail.com`, `outlook.com`, …) are rejected
  outright and can never be bound to a tenant.
- Every other domain requires a `traivr-domain-verification=<token>` TXT
  record, checked with a real DNS lookup (`src/lib/auth/sso.ts`). Changing
  the domain resets verification and drops enforcement.

**The client secret is never stored in the database.** It is read from the
environment as `SSO_CLIENT_SECRET_<ORG_SLUG>`. A secret in a row is a secret
in every backup, replica, and support query. The UI reports only whether one
is present, never its value, and the form does not accept one.

**The flow.** Authorization code + PKCE (S256), with `state` and `nonce`
each bound to an HttpOnly, SameSite=Lax cookie. The issuer URL is validated
as `https` before its discovery document is fetched, since a tenant-supplied
URL is an SSRF vector.

**The returned `id_token` is fully verified** (`verifyIdToken` in
`src/lib/auth/sso.ts`) before any identity is believed:

- signature against the issuer's published JWKS, so an unsigned or forged
  token is refused — without this an `id_token` is just a base64 string the
  browser handed us
- `iss` matches the discovered issuer
- `aud` matches our client id, so another relying party of the same IdP
  cannot replay its token at us
- `nonce` matches the cookie for this attempt, which is what stops a
  previously captured token being replayed
- `exp`/`iat`, with 60s clock tolerance

There is no fallback to the userinfo endpoint when an `id_token` is absent:
that would mean accepting an identity whose signature we never checked.

An explicit `email_verified: false` is refused. A provider that omits the
claim is trusted for its own domain — and the email must still sit under the
organization's *verified* domain, because an IdP is authoritative for its own
domain and nothing else.

**Session handoff.** A route handler cannot mint an Auth.js session, so the
callback records a single-use `SsoTicket` (60-second expiry) and the
`sso-ticket` provider consumes it inside a conditional update, so two tabs
racing the same ticket produce at most one session. A user id in a redirect
URL would have been forgeable; a ticket is not.

**Enforcement.** With `ssoEnforced` on a verified domain, password sign-in
is refused for every account on that domain — checked before the password is
compared, since the answer doesn't depend on it. Advisory enforcement would
leave a deprovisioned employee able to sign in with a password they
remember.

### SSO gaps

- **No just-in-time provisioning.** An account must already exist and be
  invited. This is a deliberate choice, not a missing feature: creating users
  straight from an IdP assertion would admit everyone in the tenant's
  directory.
- **No SAML**, no SCIM directory sync, no IdP-initiated sign-in.
- **No refresh-token handling or single logout.** Signing out of the IdP does
  not end a Traivr session; the 8-hour session lifetime bounds it.

## Two-factor authentication (TOTP)

Implemented in `lib/auth/two-factor.ts`, `server/actions/two-factor.ts`, and
the `"two-factor-ticket"` Credentials provider in `lib/auth/index.ts`.

- **Enrollment is two-phase.** `startEnroll2fa` generates a secret and stores
  it encrypted, but leaves `twoFactorEnabled` false. `confirmEnroll2fa` only
  flips it to true after the person proves they can produce a real code from
  it — otherwise a page reload mid-setup could lock someone out of an
  account "enabled" for a factor they never actually captured.
- **The TOTP secret is encrypted at rest** (AES-256-GCM, keyed off
  `SHA-256(AUTH_SECRET)`) in `lib/security/field-encryption.ts` — never stored
  or logged in plaintext.
- **Ten recovery codes** (`xxxx-xxxx`, SHA-256 hashed, single-use) are issued
  once at enrollment and shown exactly once. Losing them means losing the
  recovery path, not the account — support can still disable 2FA for a
  verified owner.
- **Disabling 2FA requires the password**, not just an authenticated session,
  so an unlocked, signed-in browser can't be used to strip the second factor.
- **The same challenge flow gates both password and OAuth sign-in.** A
  2FA-enabled account gets a single-use `TwoFactorChallenge` row (5-minute
  expiry) regardless of entry point, consumed by the `"two-factor-ticket"`
  provider — one implementation, not two.
- **Clock drift tolerance is ±30 seconds**, matching one full TOTP step in
  either direction — enough for a phone with a slightly wrong clock, not
  enough to make replay easy.

## OAuth sign-in (Google)

Implemented in `server/services/oauth-account.ts` (linking/creation
decisions) and the `signIn`/`jwt` callbacks in `lib/auth/index.ts`. There is
no Prisma Adapter — every linking and account-creation decision is explicit
in `resolveOAuthSignIn`, not implicit adapter behavior.

- **Requires a verified email from the provider.** A sign-in is refused if
  the provider doesn't return an email, or returns one it hasn't verified
  itself (`email_verified: false`) — this is the only identity fact being
  trusted, so it has to be provider-attested.
- **SSO-enforced domains block it.** If an organization's domain requires
  SSO (see above), a personal Google account on that domain is refused the
  same way a password sign-in would be.
- **Linking is by verified email match**, not by whatever the user happens to
  claim: an existing account with the same verified email gets the OAuth
  identity linked (and, if it was `PENDING`, activated); no match creates a
  new `TRAINER` account. The `jwt` callback re-derives the user id from the
  exact `(provider, providerAccountId)` pair, not from email, to avoid any
  ambiguity if emails are ever reused.
- **Requires `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`** (Auth.js's
  provider-id-based env convention — not read explicitly by this codebase).
  The button renders regardless; signing in fails gracefully to a provider
  error page if the pair is unset. Redirect URI to register:
  `https://<domain>/api/auth/callback/google`.

## Explicitly mocked (do not mistake for production-ready)

- **Email** (`lib/email/client.ts`) — logs to console and returns
  `{ mocked: true }` when `RESEND_API_KEY` is unset. Real sending requires a
  configured Resend key.

  When email is unconfigured, sign-up shows the confirmation link on screen
  instead of claiming to have sent one. That is a deliberate trade for demo
  deployments: it means **email ownership is not proven** — someone can sign
  up with an address they don't control and activate it themselves. Set
  `RESEND_API_KEY` before real users, and the link stops being shown.

  Two related paths deliberately do *not* reveal it: the resend endpoint,
  which accepts any address and would otherwise let anyone activate someone
  else's pending account, and password reset, where it would be outright
  account takeover. A send *failure* on a configured deployment also keeps
  the link hidden — that's a transient fault, not an unconfigured host.
- **File storage** (`src/lib/storage/s3.ts`) — implemented for one purpose
  only (manual identity-verification uploads, see above); every function
  throws rather than mocking a fake success when `STORAGE_*` env vars are
  unset, since there's no meaningful decision to fake for "did this image
  actually get stored." Dataset exports use a separate synchronous processor
  (`src/server/services/export-processor.ts`): JSONL/CSV content is snapshotted
  in the database and served through an authenticated download route.
- **Background jobs** — no durable export or webhook queue. Exports run
  synchronously; webhook delivery is fire-and-forget with no retry queue.
- **Rate limiting** (`src/lib/security/rate-limit.ts`) — implemented for
  password login, signup, contact, reset/resend and the versioned API. Uses
  shared Upstash counters when configured, otherwise per-instance memory.
  Store failures fail open; `RATE_LIMIT_ENABLED=false` disables limits.
  Verify shared counters before relying on limits in a serverless deployment.
- **Identity verification** (`src/lib/identity/persona.ts`) — simulates
  document/liveness/face-match/dedupe decisions unless `PERSONA_API_KEY` and
  `PERSONA_TEMPLATE_ID` are set, so the review workflow can be exercised end
  to end without a vendor account. The manual-review path (above) is a
  separate, non-simulated alternative — real images, real human decision —
  available regardless of Persona's configuration state.
- **IP geolocation** (`src/lib/security/geolocation.ts`) — returns empty
  results unless `IPINFO_TOKEN` is set.

## Planned / not yet implemented

- CSRF protection beyond Auth.js's built-in CSRF token handling for its own
  endpoints (custom mutating routes should add explicit protection as they're
  built).
- Attempt limits on the second-factor challenge path; existing password/API
  limits do not cover every authentication entry point.
- Durable retries for failed identity-image deletion. Manual identity previews
  already use short-lived signed URLs; review completion must not be mistaken
  for proof that storage deletion succeeded.
- Full audit-log coverage (the `AuditLog` model exists; write call sites are
  added incrementally as admin actions are built).
- Suspicious-login and anomaly detection (`RiskFlag` model exists; detection
  logic is not yet implemented).

## Field-level encryption

`src/lib/security/field-encryption.ts` — AES-256-GCM, keyed off `AUTH_SECRET`
rather than a separate secret (see the file's own doc comment for why).
Deliberately applied per-column, not as a blanket policy: a column only gets
added here when there's a specific, nameable harm if it leaked.

Encrypted today:

- `User.twoFactorSecret` — a TOTP secret is as sensitive as a password.
- `PaymentAccount.mpesaPhoneNumber` — a payout destination.
- `LoginEvent.ipAddress` / `User.lastLoginIp` — per-login IP history.

Not encrypted, and why that's a deliberate line rather than an oversight:
`ConsentRecord.ipAddress` and `AuditLog.ipAddress` (the latter isn't even
populated by any current call site) stay as-is for now — extend this list
before relying on that being complete for a specific compliance claim.

**Reading a column that only started encrypting partway through its
life**: use `decryptFieldOrLegacy`, not `decryptField`, wherever the column
could hold rows written before encryption was added — `mpesaPhoneNumber`
and `LoginEvent.ipAddress` both do. It falls back to the stored value as-is
when it isn't in ciphertext format, instead of throwing. This is not
theoretical: wiring `mpesaPhoneNumber` encryption without it broke both
payment pages and real M-Pesa payouts for every account created before the
change, caught by testing against actual seeded data rather than mocks
alone. `User.twoFactorSecret` has been encrypted since the column was
introduced — no legacy plaintext window ever existed for it — so it keeps
using strict `decryptField`, where a decrypt failure is a genuine integrity
problem worth throwing on, not an expected old row.

## Data retention

`src/server/services/data-retention.ts` — fixed, documented windows, swept
daily by `/api/cron/data-retention` (see `vercel.json`). Not an
admin-configurable settings table: changing a window is a code change and a
deploy, the same review bar as any other policy change here.

- Location signals (`LocationSignal`) and login history (`LoginEvent`) — 90
  days. Both are already coarse (country/region/city, hashed or encrypted
  IP) — this bounds how long even that reduced data sticks around.
- Audit log (`AuditLog`) — 7 years. Deliberately excluded from the
  short-lived telemetry schedule: this is the record that has to survive a
  dispute or compliance review, not something to age out with everything
  else.

## Reporting

This is a development-stage project. Do not use seeded demo credentials or
this configuration as-is in production — see `.env.example` and `DEPLOYMENT.md`.
