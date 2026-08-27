#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` for the build.
 *
 * This wrapper exists for one reason: a Prisma schema that declares
 * `directUrl = env("DIRECT_URL")` refuses to load at all when that variable
 * is unset, and `env()` has no fallback syntax. On a host where nothing is
 * pooled, requiring a second copy of the same connection string is pure
 * friction — and the failure it produces ("Environment variable not found")
 * arrives at build time with no hint that the two URLs are usually
 * identical.
 *
 * So: if DIRECT_URL is absent we fall back to DATABASE_URL and say so
 * loudly. That is correct for any unpooled Postgres, and for a pooled one it
 * surfaces a clear warning plus whatever the pooler says, instead of an
 * error about an environment variable.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Locates the Prisma CLI without relying on PATH.
 *
 * `npm run` puts node_modules/.bin on PATH, but this script is also run
 * directly, and a bare "prisma" then fails with ENOENT. Resolving the
 * package's own entry point and invoking it with the current Node binary
 * works in both cases and on any platform.
 */
function prismaCommand() {
  try {
    const pkg = require.resolve("prisma/package.json");
    const { bin } = require(pkg);
    const relative = typeof bin === "string" ? bin : bin?.prisma;
    if (relative) {
      const entry = join(dirname(pkg), relative);
      if (existsSync(entry)) return { command: process.execPath, prefix: [entry] };
    }
  } catch {
    // Fall through to the PATH-based lookup below.
  }

  const local = join(root, "node_modules", ".bin", "prisma");
  if (existsSync(local)) return { command: local, prefix: [] };

  return { command: "prisma", prefix: [] };
}

const env = { ...process.env };

// Same alias resolution the app uses at runtime — kept in one module so the
// build and the running site can never disagree about which database they
// mean. Duplicated as plain JS here because this script runs before any
// TypeScript build step exists.
const POOLED_KEYS = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"];
const DIRECT_KEYS = ["DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"];

const firstSet = (keys) => keys.find((k) => env[k] && env[k].trim() !== "");

const pooledKey = firstSet(POOLED_KEYS);
const directKey = firstSet(DIRECT_KEYS);

if (!pooledKey) {
  console.error(
    "\n✗ No database connection string found.\n" +
      `  Looked for: ${[...POOLED_KEYS, ...DIRECT_KEYS].join(", ")}\n` +
      "  The build applies migrations, so it needs a database. Connect one in\n" +
      "  your host's dashboard (Vercel: Storage → Create Database) or set\n" +
      "  DATABASE_URL yourself, then redeploy.\n"
  );
  process.exit(1);
}

env.DATABASE_URL = env[pooledKey];

if (directKey) {
  env.DIRECT_URL = env[directKey];
  if (directKey !== "DIRECT_URL") {
    console.log(`ℹ Using ${directKey} for migrations.`);
  }
} else {
  // No unpooled string published anywhere. Migrations take a session-level
  // advisory lock a transaction-mode pooler cannot hold, so this can fail
  // where a normal query would not — say so rather than let it look random.
  env.DIRECT_URL = env[pooledKey];
  console.warn(
    `\n⚠ No direct (unpooled) connection string found — using ${pooledKey}.\n` +
      "  Fine if your database has no connection pooler. If it does (Neon,\n" +
      "  Supabase, PgBouncer) and migrations fail on an advisory lock, set\n" +
      "  DIRECT_URL to the unpooled string.\n"
  );
}

if (pooledKey !== "DATABASE_URL") {
  console.log(`ℹ Using ${pooledKey} as the database connection.`);
}

const { command, prefix } = prismaCommand();

const result = spawnSync(command, [...prefix, "migrate", "deploy"], {
  stdio: "inherit",
  env,
  cwd: root,
});

if (result.error) {
  console.error(`\n✗ Could not run the Prisma CLI: ${result.error.message}\n`);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

// Migrations succeeded — bring the double-entry ledger up to date with any
// pre-ledger records. The backfill is idempotent (postings are unique per
// source event), so running it on every deploy is a no-op once history is
// on the books. Non-fatal by design: a backfill hiccup should show up
// loudly in the build log, not block shipping the fix for it.
console.log("\nℹ Running ledger backfill (idempotent)…");
const backfill = spawnSync(
  process.execPath,
  [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "scripts", "backfill-ledger.ts")],
  { stdio: "inherit", env, cwd: root }
);
if (backfill.error || (backfill.status ?? 1) !== 0) {
  console.warn(
    "\n⚠ Ledger backfill did not complete cleanly — the deploy continues, but\n" +
      "  run `npx tsx scripts/backfill-ledger.ts` manually and check\n" +
      "  /admin/finance shows 'Books balanced'.\n"
  );
}

process.exit(0);
