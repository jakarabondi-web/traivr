import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  checkRateLimit,
  clientIpFrom,
  rateLimitHeaders,
  resetRateLimitStore,
} from "@/lib/security/rate-limit";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetRateLimitStore();
  delete process.env.RATE_LIMIT_ENABLED;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("checkRateLimit (memory store)", () => {
  it("allows requests up to the limit, then blocks", async () => {
    const params = { bucket: "t", id: "ip-1", limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit(params)).ok).toBe(true);
    }
    const fourth = await checkRateLimit(params);
    expect(fourth.ok).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keys buckets and ids independently", async () => {
    const a = { bucket: "t", id: "ip-a", limit: 1, windowMs: 60_000 };
    expect((await checkRateLimit(a)).ok).toBe(true);
    expect((await checkRateLimit(a)).ok).toBe(false);
    // Different id: fresh budget.
    expect((await checkRateLimit({ ...a, id: "ip-b" })).ok).toBe(true);
    // Same id, different bucket: also fresh.
    expect((await checkRateLimit({ ...a, bucket: "u" })).ok).toBe(true);
  });

  it("resets after the window passes", async () => {
    vi.useFakeTimers();
    const params = { bucket: "t", id: "ip-1", limit: 1, windowMs: 1000 };
    expect((await checkRateLimit(params)).ok).toBe(true);
    expect((await checkRateLimit(params)).ok).toBe(false);
    vi.advanceTimersByTime(1500);
    expect((await checkRateLimit(params)).ok).toBe(true);
    vi.useRealTimers();
  });

  it("is disabled entirely by RATE_LIMIT_ENABLED=false", async () => {
    process.env.RATE_LIMIT_ENABLED = "false";
    const params = { bucket: "t", id: "ip-1", limit: 1, windowMs: 60_000 };
    for (let i = 0; i < 10; i++) {
      expect((await checkRateLimit(params)).ok).toBe(true);
    }
  });

  it("fails open when the store throws", async () => {
    // Point at Upstash with a fetch that always fails.
    process.env.UPSTASH_REDIS_REST_URL = "https://example.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    resetRateLimitStore();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await checkRateLimit({ bucket: "t", id: "x", limit: 1, windowMs: 60_000 });
    expect(result.ok).toBe(true);
  });
});

describe("clientIpFrom", () => {
  it("takes the first x-forwarded-for hop", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientIpFrom(h)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then a shared key", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});

describe("rateLimitHeaders", () => {
  it("includes Retry-After only when blocked", () => {
    const blocked = rateLimitHeaders({
      ok: false,
      limit: 10,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterSeconds: 30,
    });
    expect(blocked["Retry-After"]).toBe("30");
    expect(blocked["X-RateLimit-Remaining"]).toBe("0");

    const allowed = rateLimitHeaders({
      ok: true,
      limit: 10,
      remaining: 9,
      resetAt: Date.now() + 30_000,
      retryAfterSeconds: 0,
    });
    expect(allowed["Retry-After"]).toBeUndefined();
  });
});
