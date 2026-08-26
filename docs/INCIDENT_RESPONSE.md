# Incident response runbook

The internal counterpart of the public commitments on `/legal/sla`. If the
two ever disagree, fix whichever is wrong **in the same change** — a runbook
that promises less than the SLA is a breached SLA waiting to happen.

## Severity levels

| Severity | Definition | First response | Status-page updates |
|---|---|---|---|
| **Sev 1** | Platform down, data integrity at risk, or a security incident | 1 hour, 24×7 | Every 2 hours |
| **Sev 2** | Core workflow (tasks, review, exports, payouts) broken, no workaround | 4 business hours | Daily |
| **Sev 3** | Degraded behavior with a workaround | 1 business day | On change |
| **Sev 4** | Questions, feature requests | 2 business days | — |

When in doubt between two severities, pick the higher one. Downgrading a
severity mid-incident is fine; discovering too late that it was worse is not.

## Roles

Small team, so roles are hats, not headcount — one person may wear several,
but every incident has each hat explicitly assigned:

- **Incident lead** — owns the incident end to end: severity call, decisions,
  the post-incident review. Default: whoever detected it, until handed off.
- **Comms** — status page updates, customer emails. Nobody else communicates
  externally about the incident.
- **Scribe** — keeps a timestamped log *as it happens* (a running note or
  thread). The post-incident review is written from this log, not from memory.

## Response procedure

1. **Detect & declare.** Anything that looks like Sev 1/2 is declared
   immediately — say "this is an incident" in the team channel with the
   severity. Declaring and being wrong is cheap; hesitating is not.
2. **Assign hats.** Lead, comms, scribe — named people, first message.
3. **Assess blast radius.** Which components (`/status` list: web app, client
   API, database, email)? Which customers? Is customer data affected? The
   data question changes the legal notification clock — answer it early and
   log the answer.
4. **Communicate.** Sev 1/2: status-page acknowledgment before deep
   diagnosis, then updates on the SLA cadence. Never promise a fix time;
   state what is known, what is being done, when the next update comes.
5. **Mitigate first, fix second.** Prefer the fastest safe path back to
   service: roll back the deploy (Vercel → previous deployment → promote),
   disable the affected feature, fail over. Root-causing happens after
   service is restored, not before.
6. **Resolve.** Confirm via `/status` and `/api/health`, close the loop on
   the status page, and thank the reporter if there was one.

## Security incidents (always Sev 1)

Everything above, plus:

- **Contain before announcing details** — revoke the exposed credential,
  disable the account, block the vector. `SECURITY.md` documents the levers
  (sessionVersion bump signs a user out everywhere; API keys are revocable
  per key; `RATE_LIMIT_ENABLED` and per-key limits slow an active abuser).
- **Preserve evidence.** Audit logs (`/admin/audit-logs`) and login events
  are the record — do not clean up data that shows what happened.
- **Customer notification** follows each affected customer's DPA timeline
  (72 hours from confirmation unless their agreement says otherwise). The
  incident lead owns the decision that the clock has started; log it.
- Rotate any secret that *might* have been exposed. Rotation is cheap.

## Post-incident review (Sev 1: required, within 5 business days)

Written from the scribe's log. Four sections, no blame:

1. **Timeline** — detection → declaration → mitigation → resolution, with
   timestamps and the gaps honestly shown.
2. **Root cause** — the mechanism, not a person. "The deploy lacked X" is a
   cause; "Alex forgot X" is not (the missing safeguard is the cause).
3. **Customer impact** — who, what, how long, and whether data was affected.
4. **Corrective actions** — each with an owner and a date. An action without
   both is a wish, not an action.

Sev 1 reviews are shared with affected customers per the SLA.

## Contacts

- Support inbox (customer reports arrive here): `support@traivr.com`
- Status page: `/status` · Health check: `/api/health`
- Hosting: Vercel dashboard · Database: Neon dashboard · Email: Resend dashboard
