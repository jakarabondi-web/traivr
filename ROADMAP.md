# Roadmap

Status snapshot of the phases described in the product spec. This file
should be updated at the end of each implementation phase.

## Phase 1 — Foundation ✅

- Next.js/TypeScript/Tailwind v4 project, hand-built shadcn-style component
  library (shadcn's registry wasn't reachable from this environment)
- Design tokens (brand palette, light/dark themes) in `globals.css`
- Prisma schema covering identity/RBAC, organizations, trainer profile,
  assessments, projects/tasks, review/quality, datasets/exports,
  payments/billing, support/disputes, notifications/compliance
- Auth.js v5 credentials auth, JWT sessions with roles, edge-safe middleware
  gating `/trainer`, `/client`, `/admin` by surface
- Route groups: `(marketing)`, `(auth)`, `trainer`, `client`, `admin`
- Seed script with realistic fictional org/project/task/review/earning data
  and the four demo accounts

## Phase 2 — Marketing & authentication ✅

- Homepage, For AI companies, For experts, Services, Security, Pricing,
  Resources, About, Contact (form → Resend when configured, otherwise mock), Apply, legal
  stubs (Privacy/Terms/Cookies)
- Login, Register (role-aware), Forgot password, Reset password — all wired
  to real server actions and the Postgres-backed `User` model
- 403 page for cross-surface access attempts

## Phase 3 — Trainer platform ✅

All 17 trainer routes are built and reachable — no dead nav links:
application/onboarding, dashboard, project marketplace + detail, my
projects, task list, gold-task results, pairwise task workspace,
assessments + attempt runner, quality, earnings, wallet/payments, tax
summary, notifications, profile, settings, help center, tickets, and
identity verification.

Task workspace covers pairwise comparison with rubric scoring, confidence,
flags, timing, and localStorage draft recovery. Other task-type renderers
(ranking, prompt writing, code review, …) are not built yet.

## Trust & safety ✅ (verified end to end)

The applicant journey is gated and verified in a browser against Postgres:
sign up → email confirm → application → qualification assessment →
identity verification → **"application under review"** → admin decision →
approval email → marketplace unlocks. Assignments stay blocked at every
step until approved.

Done:
- Email verification is enforced — accounts start `PENDING` and cannot sign
  in until confirmed; resend flow avoids email enumeration
- Identity verification: vendor-abstracted provider contract with a Persona
  implementation, consent recording, attempt limits, duplicate-identity
  risk flags, manual review path. **Decisions only — no biometric storage**
- Work location: coarse IP geolocation, VPN/proxy/datacenter detection,
  hashed IPs, per-project jurisdiction rules, impossible-travel detection
- Agreement metrics: Krippendorff's alpha and majority agreement, unit
  tested against hand-computed values

- Approval gate (`lib/permissions/gating.ts`) — single source of truth for
  whether a trainer may access paid work, enforced server-side
- Assessment engine with timing, attempt limits, cooldowns, auto-grading,
  and human grading for written answers (correct answers never leave the
  server)
- Decision emails for submitted / approved / more-info / waitlisted /
  declined

Not yet built: admin jurisdiction-rule editor, reviewer workspace,
automatic gold-task seeding, consensus computation job, appeals UI.

## Phase 4 — Client platform ✅

All 15 client routes are built: organization onboarding, dashboard, project
list, six-step creation wizard (with templates), project overview plus
tasks/quality/workforce tabs, datasets, exports, team management with
invitations, billing, invoices, API & webhooks, security, and settings.

**Tenant isolation** is enforced through `server/services/tenant.ts` — every
client query resolves the organization from `OrganizationMember`, never from
a role check or a caller-supplied id. A project belonging to another
organization 404s identically to one that doesn't exist, so existence
can't be probed. Covered by unit tests in `src/tests/tenant-isolation.test.ts`.

Client-facing quality reporting computes Krippendorff's alpha per project
and explains how to read it, including flagging that low agreement usually
indicates an ambiguous rubric rather than poor trainers.

Task import, client-side rubric editing, API keys, and SSO are all built —
see below.

## Task import ✅

JSONL and CSV import at `/client/projects/[id]/import`, with the same
importer available to operations staff at `/admin/projects/[id]/import`.

Preview-then-commit: nothing is written until the client confirms a screen
showing exactly what will land, which rows fail and why (with line numbers),
and a preview of what trainers will actually see. The file is re-validated
on commit rather than trusting the previewed result, since the content
round-trips through the client between the two calls.

Rows are validated against the field shape the project's task type
requires, so a pairwise file can't be imported into a fact-checking project.
`external_ref` makes re-imports idempotent — re-running a file adds only
genuinely new rows. Gold tasks can be seeded inline with `is_gold` +
`expected_answer`; a gold row without either is rejected rather than
silently downgraded to a normal task.

Internal ops staff can import on a client's behalf without being an
organization member. That carve-out is narrow and recorded distinctly in
the audit log (`project.tasks_imported_by_staff`), so a third-party write
into a client's project is never indistinguishable from the client's own.

Parser behaviour is covered by 26 unit tests.

## Reviewer workspace ✅

Blind review workspace at `/trainer/review`, gated on the `task.review`
permission so a plain trainer can't reach it. Reviewers see the prompt,
both responses, the trainer's preference and justification — but never the
trainer's identity.

Approve / request revision / reject / escalate, with rubric scores, error
categories, and a confidence rating. Anything other than an approval
requires written feedback, since the trainer reads it. Approving is what
creates the trainer's earning, so that happens in the same transaction as
the decision. Gold-task outcomes are recorded either way as calibration
signal, and reviewers see their own peer-agreement alpha.

Not yet built: lead-reviewer adjudication queue for escalations, and
automatic gold-task seeding into live queues.

## Phase 5 — Admin platform 🚧 mostly built

All 18 admin routes are built: dashboard, trainers list + detail,
applications review, clients, projects, tasks, review queue, quality
(with live Krippendorff's alpha), assessments + written-answer grading,
payouts, invoices, disputes, support, fraud, compliance, audit logs,
users & roles, and settings.

Not yet built: project creation/editing from the admin side, task import,
reviewer assignment, and the reviewer workspace itself.

## Phase 6 — Enterprise & integrations 🔶 partial

**Built: the versioned client API.** `/api/v1/projects`, `/tasks`,
`/submissions`, and `/exports`, authenticated by organization-scoped API
keys hashed with SHA-256 and issued once from the client portal. Scope
(read / read+write), expiry, and revocation are enforced per request, and
the organization is resolved from the key — a caller-supplied
`organizationId` is ignored. Task ingest reuses the upload screen's parser,
so the API and UI can't drift into accepting different data, and is
idempotent on `external_ref`. Full contract in `API.md`.

**Built: enterprise SSO over OIDC.** Per-organization issuer configuration,
authorization code + PKCE, and `state` bound to an HttpOnly cookie. Domain
ownership is proved by a DNS TXT record rather than asserted, public email
domains are refused outright, and the client secret lives in the environment
rather than the database. Enforcement blocks password sign-in for a verified
domain. Session handoff from the callback route uses a single-use
`SsoTicket`. The returned `id_token` is verified against the issuer's JWKS
with `iss`, `aud`, `nonce`, and expiry all checked. No just-in-time
provisioning, by design — see `SECURITY.md`.

**Built:** synchronous JSONL/CSV exports, outbound webhook dispatch, API rate
limiting with optional shared Upstash counters, and private object storage for
manual identity verification. Provider configuration still requires validation.

**Not built:** durable export/webhook workers and retries, SAML/SCIM, and
additional payment integrations beyond the Stripe Connect and M-Pesa paths.

## Cross-cutting, not yet done

- Playwright E2E suite — flows are currently verified by driving a real
  browser against Postgres during development, but those runs aren't
  committed as regression tests. Vitest unit tests do exist: 123 covering
  agreement metrics, tenant isolation, the import parser, rubrics, API-key
  handling, request validation, SSO domain/PKCE logic, and `id_token`
  signature verification.
- Production validation of shared rate limiting, field encryption and signed
  identity-preview URLs; second-factor attempt limits and durable deletion
  retries (see `SECURITY.md`)
- Repository layer (`server/repositories`) for shared/testable query logic
