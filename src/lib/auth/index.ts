import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { headers } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import type { GlobalRole } from "@/lib/permissions/roles";
import {
  consumeRecoveryCode,
  createTwoFactorChallenge,
  verifyTotpCode,
} from "@/lib/auth/two-factor";
import { decryptField } from "@/lib/security/field-encryption";
import { isSupportedOAuthAccount } from "@/lib/auth/oauth-providers";
import { resolveOAuthSignIn } from "@/server/services/oauth-account";
import { recordSuccessfulLogin } from "@/lib/auth/login-events";
import { checkRateLimit, clientIpFrom } from "@/lib/security/rate-limit";

import { authConfig } from "./config";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Auth.js only forwards a `code` to the client when it's declared as a class
 * property on a CredentialsSignin subclass — a code passed to the constructor
 * sets the message instead and is masked as the generic "credentials".
 */
class EmailUnverifiedError extends CredentialsSignin {
  code = "email_unverified";
}

class AccountInactiveError extends CredentialsSignin {
  code = "account_inactive";
}

/** The account's domain is bound to an organization that requires SSO. */
class SsoRequiredError extends CredentialsSignin {
  code = "sso_required";
}

/**
 * The password was correct, but the account has 2FA enabled. The challenge
 * token rides inside the error code because CredentialsSignin has no other
 * channel back to the client — the login form parses the suffix and sends
 * the person to /login/verify-2fa.
 */
class TwoFactorRequiredError extends CredentialsSignin {
  code: string;
  constructor(challengeToken: string) {
    super();
    this.code = `two_factor_required:${challengeToken}`;
  }
}

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Per-IP throttle on top of the per-account lockout below: the
        // lockout stops a password spray against one account, this stops
        // one machine spraying many accounts. Generous enough that a shared
        // office IP with a few fumbled logins never notices it.
        const throttle = await checkRateLimit({
          bucket: "login",
          id: clientIpFrom(request.headers),
          limit: 20,
          windowMs: 5 * 60_000,
        });
        if (!throttle.ok) return null;

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          include: { roles: { include: { role: true } } },
        });
        if (!user || !user.passwordHash) return null;

        if (user.lockedUntil && user.lockedUntil > new Date()) {
          return null;
        }

        // If the account's email domain belongs to an organization that
        // enforces SSO, the password path is closed — otherwise enforcement
        // would be advisory, and a former employee whose IdP account was
        // deprovisioned could still sign in with a password they remember.
        // Checked before the password is compared: the answer doesn't depend
        // on it.
        const domain = user.email.split("@")[1]?.toLowerCase();
        if (domain) {
          const ssoOrg = await prisma.organization.findFirst({
            where: {
              ssoDomain: domain,
              ssoEnforced: true,
              ssoDomainVerifiedAt: { not: null },
            },
            select: { id: true },
          });
          if (ssoOrg) throw new SsoRequiredError();
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          const failedCount = user.failedLoginCount + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: failedCount,
              lockedUntil:
                failedCount >= LOCKOUT_THRESHOLD
                  ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
                  : null,
            },
          });
          return null;
        }

        // PENDING means the email address has never been confirmed;
        // SUSPENDED/DEACTIVATED are enforcement states. None may sign in.
        if (user.status !== "ACTIVE") {
          throw user.status === "PENDING" ? new EmailUnverifiedError() : new AccountInactiveError();
        }
        if (!user.emailVerifiedAt) {
          throw new EmailUnverifiedError();
        }

        await recordSuccessfulLogin(user.id, request.headers);

        // The password is proven at this point, but a 2FA-enabled account
        // still needs a second factor before a session is minted. There is
        // no session yet to "pause" — instead a fresh challenge is opened
        // and the client is sent to consume it, which is also what the
        // OAuth path below does, so both entry points share one UI and one
        // ticket-consuming provider.
        if (user.twoFactorEnabled) {
          const token = await createTwoFactorChallenge(user.id);
          throw new TwoFactorRequiredError(token);
        }

        const roles = user.roles.map((r) => r.role.key) as GlobalRole[];

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          image: user.avatarUrl ?? undefined,
          roles,
          sessionVersion: user.sessionVersion,
        };
      },
    }),

    /**
     * Consumes the single-use ticket left by a completed OIDC callback.
     *
     * This provider trusts the ticket and nothing else: no password, no
     * email, no user id from the request. The ticket is deleted-on-use
     * inside a conditional update, so two tabs racing the same ticket can
     * only produce one session.
     */
    Credentials({
      id: "sso-ticket",
      name: "Single sign-on",
      credentials: { ticket: { label: "Ticket", type: "text" } },
      async authorize(raw, request) {
        const ticket = typeof raw?.ticket === "string" ? raw.ticket : null;
        if (!ticket) return null;

        const claimed = await prisma.ssoTicket.updateMany({
          where: { token: ticket, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) return null;

        const row = await prisma.ssoTicket.findUnique({
          where: { token: ticket },
          include: { user: { include: { roles: { include: { role: true } } } } },
        });
        if (!row || row.user.status !== "ACTIVE") return null;

        await recordSuccessfulLogin(row.userId, request.headers);

        return {
          id: row.user.id,
          email: row.user.email,
          name: `${row.user.firstName} ${row.user.lastName}`,
          image: row.user.avatarUrl ?? undefined,
          roles: row.user.roles.map((r) => r.role.key) as GlobalRole[],
          sessionVersion: row.user.sessionVersion,
        };
      },
    }),

    /**
     * Consumes a 2FA challenge — the counterpart to TwoFactorRequiredError
     * above and to the redirect the OAuth signIn callback issues below.
     *
     * The code is checked here, inside the same call that claims the
     * challenge, so a wrong guess never burns the one-time token: the
     * challenge is only marked consumed once verification actually
     * succeeds, guarded by a conditional update against a second tab
     * racing the same successful code.
     */
    Credentials({
      id: "two-factor-ticket",
      name: "Two-factor verification",
      credentials: {
        challenge: { label: "Challenge", type: "text" },
        code: { label: "Code", type: "text" },
      },
      async authorize(raw, request) {
        const challengeToken = typeof raw?.challenge === "string" ? raw.challenge : null;
        const code = typeof raw?.code === "string" ? raw.code.trim() : null;
        if (!challengeToken || !code) return null;

        const challenge = await prisma.twoFactorChallenge.findUnique({
          where: { token: challengeToken },
        });
        if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) return null;

        const user = await prisma.user.findUnique({
          where: { id: challenge.userId },
          include: { roles: { include: { role: true } } },
        });
        if (!user || !user.twoFactorEnabled || user.status !== "ACTIVE") return null;

        let verified = false;
        let remainingRecoveryCodes: string[] | null = null;

        if (user.twoFactorSecret && (await verifyTotpCode(decryptField(user.twoFactorSecret), code))) {
          verified = true;
        } else {
          const recovery = consumeRecoveryCode(user.twoFactorRecoveryCodes, code);
          if (recovery.valid) {
            verified = true;
            remainingRecoveryCodes = recovery.remaining;
          }
        }

        if (!verified) return null;

        const claimed = await prisma.twoFactorChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) return null;

        if (remainingRecoveryCodes) {
          await prisma.user.update({
            where: { id: user.id },
            data: { twoFactorRecoveryCodes: remainingRecoveryCodes },
          });
        }

        await recordSuccessfulLogin(user.id, request.headers);

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          image: user.avatarUrl ?? undefined,
          roles: user.roles.map((r) => r.role.key) as GlobalRole[],
          sessionVersion: user.sessionVersion,
        };
      },
    }),

    // clientId/clientSecret are read from AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET
    // automatically — Auth.js's env-variable convention for providers, not
    // something this file wires up itself. The button renders regardless;
    // signing in redirects to a provider error page if the pair is unset.
    Google({}),
  ],
  callbacks: {
    ...authConfig.callbacks,

    /**
     * Runs only for the federated providers above — the Credentials
     * providers resolve everything inside `authorize` and never reach here
     * with a federated `account` present.
     *
     * See resolveOAuthSignIn for the rules (verified email required, SSO
     * domains excluded, account linking by verified email). A 2FA-enabled
     * account cannot be signed into directly from here: returning a URL
     * aborts the OAuth callback without creating a session, exactly like
     * denying it, except the destination carries a fresh challenge token so
     * the same verify-2fa screen the password path uses can finish the job.
     */
    async signIn({ user, account, profile }) {
      if (!isSupportedOAuthAccount(account)) return true;

      const p = (profile ?? {}) as Record<string, unknown>;
      const resolution = await resolveOAuthSignIn(
        account.provider,
        {
          email: typeof p.email === "string" ? p.email : null,
          emailVerified: typeof p.email_verified === "boolean" ? p.email_verified : null,
          givenName: typeof p.given_name === "string" ? p.given_name : null,
          familyName: typeof p.family_name === "string" ? p.family_name : null,
          name: typeof p.name === "string" ? p.name : null,
          picture: typeof p.picture === "string" ? p.picture : null,
        },
        {
          providerAccountId: account.providerAccountId,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          tokenType: account.token_type,
          scope: account.scope,
          idToken: account.id_token,
        }
      );

      if (resolution.outcome === "denied") {
        return `/login?error=oauth_${resolution.reason}`;
      }

      if (resolution.user.twoFactorEnabled) {
        const token = await createTwoFactorChallenge(resolution.user.id);
        return `/login/verify-2fa?challenge=${token}`;
      }

      // The `user` object handed to `jwt` right after this is this exact
      // same reference when there is no adapter, so rewriting it here
      // should be enough on its own. `jwt` below re-derives the same thing
      // from the database as a fallback rather than trusting that
      // unconditionally — cheap insurance against relying on exactly how
      // Auth.js threads this object internally.
      user.id = resolution.user.id;
      (user as { roles?: GlobalRole[] }).roles = resolution.user.roles;
      (user as { sessionVersion?: number }).sessionVersion = resolution.user.sessionVersion;

      // No Request object reaches this callback (unlike Credentials'
      // authorize), so the incoming headers are read from the request-scoped
      // next/headers store instead — this callback only ever runs inside the
      // OAuth callback route handler's request.
      await recordSuccessfulLogin(resolution.user.id, await headers());

      return true;
    },

    /**
     * Defensive fallback for the OAuth roles set in `signIn` above: if they
     * didn't make it onto the token for any reason, re-derive them from the
     * database by the (provider, providerAccountId) `signIn` already
     * linked, rather than silently minting a session with no roles at all.
     */
    async jwt(params) {
      const token = await authConfig.callbacks!.jwt!(params);
      if (!token) return token;
      const { account } = params;
      if (
        isSupportedOAuthAccount(account) &&
        !(Array.isArray(token.roles) && token.roles.length > 0)
      ) {
        const linked = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account!.providerAccountId as string,
            },
          },
          include: { user: { include: { roles: { include: { role: true } } } } },
        });
        if (linked) {
          token.userId = linked.user.id;
          token.roles = linked.user.roles.map((r) => r.role.key) as GlobalRole[];
        }
      }

      // "Sign out everywhere": on every request that re-decodes an existing
      // token (params.user is only present at the moment of sign-in, never
      // on a later request), compare the version embedded in the token
      // against the account's current value. A mismatch means the account
      // holder bumped it since this token was issued, so the token is dead
      // regardless of its expiry. This is a Node-only check — the edge-safe
      // authConfig used by middleware has no Prisma access, so a revoked
      // session stays valid for edge routing decisions until the next
      // Node-runtime auth() call (Server Component/Action) rejects it.
      const tokenUserId = token.userId;
      if (!params.user && typeof tokenUserId === "string") {
        const current = await prisma.user.findUnique({
          where: { id: tokenUserId },
          select: { sessionVersion: true, status: true },
        });
        if (!current || current.status !== "ACTIVE" || current.sessionVersion !== token.sessionVersion) {
          return null;
        }
      }

      return token;
    },
  },
});
