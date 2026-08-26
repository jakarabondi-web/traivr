import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { bearerFrom, digestsMatch, hashApiKey, looksLikeApiKey } from "@/lib/api/keys";
import { checkRateLimit, clientIpFrom, rateLimitHeaders } from "@/lib/security/rate-limit";

/** Requests per key per minute across the versioned API. */
const API_KEY_LIMIT = 240;
/** Unauthenticated attempts per IP per minute — enough for a misconfigured
 *  client to notice, not enough to enumerate keys. */
const API_ANON_LIMIT = 30;

/**
 * Authentication and tenant scoping for the versioned client API.
 *
 * This is the API-side counterpart of `services/tenant.ts`. The rule is the
 * same and it is the whole point of the module: the organization is resolved
 * from the *key*, never from anything the caller sends. A request body or
 * query string containing an organizationId is ignored — a key can only ever
 * see the tenant it was issued to.
 */

export type ApiContext = {
  keyId: string;
  organizationId: string;
  organizationName: string;
  canWrite: boolean;
};

export type ApiFailure = { response: NextResponse };

export function isFailure<T extends object>(value: T | ApiFailure): value is ApiFailure {
  return "response" in value;
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: object,
  headers?: Record<string, string>
) {
  return NextResponse.json(
    { error: { code, message, ...extra } },
    { status, headers: { "Cache-Control": "no-store", ...headers } }
  );
}

export function apiOk(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Resolves an API key into a tenant context.
 *
 * Every rejection returns the same shape and a deliberately unspecific
 * message: a caller must not be able to tell a revoked key from an expired
 * one from a key that never existed.
 */
export async function authenticateApiRequest(
  request: Request,
  options: { write?: boolean } = {}
): Promise<ApiContext | ApiFailure> {
  const token = bearerFrom(request.headers.get("authorization"));

  if (!token || !looksLikeApiKey(token)) {
    // Requests without a plausible key are limited by IP — this is the
    // path a key-enumeration attempt lives on.
    const anon = await checkRateLimit({
      bucket: "api-anon",
      id: clientIpFrom(request.headers),
      limit: API_ANON_LIMIT,
      windowMs: 60_000,
    });
    if (!anon.ok) {
      return {
        response: apiError(
          429,
          "rate_limited",
          "Too many requests. Slow down and retry.",
          undefined,
          rateLimitHeaders(anon)
        ),
      };
    }
    return {
      response: apiError(401, "unauthorized", "Provide a valid API key as a bearer token.", {
        docs: "/client/api",
      }),
    };
  }

  const digest = hashApiKey(token);

  // Well-formed keys are limited by the key itself (hashed — the digest is
  // an opaque stable id), so one noisy integration can't starve an IP shared
  // by other tenants, and rotating IPs doesn't reset the budget.
  const limited = await checkRateLimit({
    bucket: "api",
    id: digest.slice(0, 32),
    limit: API_KEY_LIMIT,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return {
      response: apiError(
        429,
        "rate_limited",
        `This key is limited to ${API_KEY_LIMIT} requests per minute. Retry after ${limited.retryAfterSeconds}s.`,
        undefined,
        rateLimitHeaders(limited)
      ),
    };
  }
  const key = await prisma.apiKey.findUnique({
    where: { hashedKey: digest },
    include: { organization: true },
  });

  const now = new Date();
  const usable =
    key !== null &&
    digestsMatch(key.hashedKey, digest) &&
    key.revokedAt === null &&
    (key.expiresAt === null || key.expiresAt > now) &&
    key.organizationId !== null &&
    key.organization !== null;

  if (!usable || !key || !key.organization || !key.organizationId) {
    return { response: apiError(401, "unauthorized", "Provide a valid API key as a bearer token.") };
  }

  const canWrite = key.scopes.includes("WRITE");
  if (options.write && !canWrite) {
    return {
      response: apiError(403, "insufficient_scope", "This key is read-only. Issue a key with the write scope."),
    };
  }

  // Recorded so a client can spot a leaked key that is still being used.
  // Fire-and-forget: a failed bookkeeping write must not fail the request.
  void prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: now } })
    .catch(() => undefined);

  return {
    keyId: key.id,
    organizationId: key.organizationId,
    organizationName: key.organization.name,
    canWrite,
  };
}

/** Clamps pagination so a caller can't ask for the whole table. */
export function pagination(url: URL, defaultLimit = 50, maxLimit = 200) {
  const rawLimit = Number(url.searchParams.get("limit"));
  const rawOffset = Number(url.searchParams.get("offset"));

  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), maxLimit) : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}

const MAX_BODY_BYTES = 2_000_000;

/**
 * Reads and size-limits a JSON body.
 *
 * The limit is enforced on bytes actually read, not on `content-length`.
 * That header is supplied by the caller and is simply absent on a chunked
 * request, so trusting it means the cap can be skipped by anyone who wants
 * to — and the whole body gets buffered into memory before any validation
 * runs. Reading the stream and stopping at the limit is the only version of
 * this check that is actually a check.
 */
export async function readJson(request: Request): Promise<{ data: unknown } | ApiFailure> {
  const tooLarge = () =>
    apiError(413, "payload_too_large", "Request bodies are limited to 2 MB. Use fewer items per call.");

  // Cheap pre-check: reject an honestly-declared oversized body before
  // reading a single byte of it.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { response: tooLarge() };
  }

  if (!request.body) {
    return { response: apiError(400, "invalid_json", "Request body must be valid JSON.") };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { response: tooLarge() };
      }
      chunks.push(value);
    }
  } catch {
    return { response: apiError(400, "invalid_json", "Request body could not be read.") };
  }

  const body = Buffer.concat(chunks).toString("utf8");

  try {
    return { data: JSON.parse(body) };
  } catch {
    return { response: apiError(400, "invalid_json", "Request body must be valid JSON.") };
  }
}

/**
 * Validates a filter value against a known set of enum members.
 *
 * Passing an unchecked string through to Prisma as an enum turns a caller's
 * typo into an unhandled query error and a bare 500 — the caller learns
 * nothing and the error looks like our fault.
 */
export function enumFilter<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  field: string
): { value: T | undefined } | ApiFailure {
  if (raw === null || raw === "") return { value: undefined };

  const upper = raw.toUpperCase() as T;
  if (!allowed.includes(upper)) {
    return {
      response: apiError(400, "invalid_parameter", `${field} must be one of: ${allowed.join(", ")}.`),
    };
  }
  return { value: upper };
}

export const PROJECT_STATUSES = [
  "DRAFT", "PENDING_SETUP", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED",
] as const;

export const TASK_STATUSES = [
  "UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW",
  "REVISION_REQUESTED", "APPROVED", "REJECTED", "ESCALATED",
] as const;

export const REVIEW_DECISIONS = [
  "APPROVED", "REVISION_REQUESTED", "REJECTED", "ESCALATED",
] as const;

/** Confirms a project belongs to the key's organization before it is touched. */
export async function projectForKey(projectId: string, ctx: ApiContext) {
  return prisma.project.findFirst({
    where: { id: projectId, organizationId: ctx.organizationId },
  });
}

export async function logApiAction(ctx: ApiContext, action: string, entityId: string, metadata?: object) {
  await prisma.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      action,
      entityType: "ApiKey",
      entityId,
      metadata: { ...metadata, viaApiKey: ctx.keyId },
    },
  });
}
