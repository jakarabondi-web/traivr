/**
 * Rate limiting with a pluggable counter store.
 *
 * Fixed-window counters: cheap, predictable, and honest about their one
 * quirk (a burst can straddle a window boundary), which is acceptable for
 * abuse control — this exists to stop credential stuffing and API
 * hammering, not to meter billing.
 *
 * Store selection:
 * - Upstash Redis (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN):
 *   shared counters across every serverless instance. What production
 *   should run.
 * - In-memory fallback otherwise: per-instance counters. On a single
 *   long-lived server this is exact; on serverless it under-counts across
 *   instances but still stops any single hot path. Deliberately fail-open
 *   rather than requiring infrastructure to boot.
 *
 * RATE_LIMIT_ENABLED=false turns the whole thing off (load tests, local
 * debugging). Any other value — including unset — leaves it on.
 */

type WindowResult = {
  /** Requests recorded in the current window, including this one. */
  count: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
};

interface CounterStore {
  increment(key: string, windowMs: number): Promise<WindowResult>;
}

class MemoryStore implements CounterStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private sweepAt = Date.now();

  async increment(key: string, windowMs: number): Promise<WindowResult> {
    const now = Date.now();

    // Opportunistic sweep so abandoned keys don't accumulate forever.
    if (now > this.sweepAt) {
      this.sweepAt = now + 60_000;
      for (const [k, v] of this.buckets) {
        if (v.resetAt <= now) this.buckets.delete(k);
      }
    }

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }
}

class UpstashStore implements CounterStore {
  constructor(
    private url: string,
    private token: string
  ) {}

  async increment(key: string, windowMs: number): Promise<WindowResult> {
    // INCR + PEXPIRE NX in one pipeline round trip. PEXPIRE ... NX only
    // sets the TTL when none exists, which is exactly "start the window on
    // the first request".
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(windowMs), "NX"],
        ["PTTL", key],
      ]),
      // A rate limiter that adds seconds of latency is worse than none.
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`Upstash pipeline failed: ${res.status}`);
    const rows = (await res.json()) as Array<{ result: number }>;
    const count = rows[0]?.result ?? 1;
    const ttl = rows[2]?.result ?? windowMs;
    return { count, resetAt: Date.now() + (ttl > 0 ? ttl : windowMs) };
  }
}

let store: CounterStore | null = null;

function getStore(): CounterStore {
  if (!store) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    store = url && token ? new UpstashStore(url, token) : new MemoryStore();
  }
  return store;
}

/** Test hook: reset the lazily-created store so env changes take effect. */
export function resetRateLimitStore() {
  store = null;
}

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

/**
 * Records one hit against `bucket:id` and says whether it's within limits.
 *
 * Fails open: if the counter store is unreachable, the request goes
 * through. Availability of the product beats perfection of the limiter,
 * and the account-lockout logic still backstops the credential paths.
 */
export async function checkRateLimit(params: {
  /** Logical group, e.g. "login", "api", "password-reset". */
  bucket: string;
  /** Who is being limited — an IP, an API key id, an email. */
  id: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  const allowed: RateLimitResult = {
    ok: true,
    limit: params.limit,
    remaining: params.limit,
    resetAt: Date.now() + params.windowMs,
    retryAfterSeconds: 0,
  };

  if (process.env.RATE_LIMIT_ENABLED === "false") return allowed;

  try {
    const { count, resetAt } = await getStore().increment(
      `rl:${params.bucket}:${params.id}`,
      params.windowMs
    );
    const remaining = Math.max(0, params.limit - count);
    return {
      ok: count <= params.limit,
      limit: params.limit,
      remaining,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  } catch {
    return allowed;
  }
}

/** Best-effort client IP for keying. Behind Vercel/most proxies the first
 *  x-forwarded-for hop is the client. Falls back to a shared key rather
 *  than disabling the limit entirely when no IP is derivable. */
export function clientIpFrom(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/** Standard headers for a 429 (or to annotate a successful response). */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    ...(result.ok ? {} : { "Retry-After": String(result.retryAfterSeconds) }),
  };
}
