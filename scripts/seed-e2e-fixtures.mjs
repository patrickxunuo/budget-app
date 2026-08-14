// Seeds the minimum Auth identity the browser journeys need, against a LOCAL
// Supabase only.
//
//   pnpm seed:e2e
//
// Why this exists: `pnpm test:db` ends with `supabase db reset`, which leaves a
// database with no `auth.users` rows at all, and the application is invite-only
// with first-owner setup as the sole bootstrap. Every fixture-gated browser
// journey therefore had no member to sign in as, so CI skipped all of them and
// still reported green. That silent skip is what GH-14 exists to end.
//
// This creates one active owner and prints the environment assignments that
// provision the fixture families depending on it. It is deliberately narrow: it
// seeds an identity, not financial data. Journeys that additionally need an
// activated Plaid Item or a disposable destructive workspace stay gated, and
// the end-of-run fixture inventory continues to say so.
//
// Refuses to run against anything but a loopback Supabase URL, so it can never
// mint an owner in a hosted project.
//
// Credentials come from the process environment, falling back to .env.local —
// the same contract as scripts/plaid-sandbox-smoke.mjs. CI exports them from
// `supabase status` and never writes a .env.local, so only the first half
// applies there.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv() {
  const values = new Map();
  try {
    const file = readFileSync(join(repoRoot, ".env.local"), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const trimmed = line.trim();
      const separator = trimmed.indexOf("=");
      if (!trimmed || trimmed.startsWith("#") || separator === -1) continue;
      values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
    }
  } catch {
    // A missing .env.local is fine when the values are already exported.
  }
  return (key) => process.env[key] ?? values.get(key);
}

const env = readEnv();

const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const EMAIL = env("E2E_SEED_EMAIL") ?? "e2e-owner@budget.local";
const PASSWORD = env("E2E_SEED_PASSWORD") ?? "E2eOwner!2026-seed";
const DISPLAY_NAME = "E2E Owner";
const WORKSPACE_NAME = "E2E Family";

function fail(message) {
  console.error(`[seed-e2e-fixtures] ${message}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  fail(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.",
  );
}

const hostname = new URL(SUPABASE_URL).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
  fail(
    `refusing to seed a non-loopback Supabase project (${hostname}). This script is for local and CI databases only.`,
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Idempotent: a re-run against an already-seeded database must succeed rather
// than half-fail, because CI may retry the job and a developer will re-run this
// far more often than they reset.
async function findExistingUser(email) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) fail(`could not list Auth users: ${error.message}`);
  return data.users.find((user) => user.email?.toLowerCase() === email);
}

const email = EMAIL.toLowerCase();
let user = await findExistingUser(email);

if (!user) {
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    fail(`could not create the owner identity: ${created.error?.message}`);
  }
  user = created.data.user;
  console.log(`[seed-e2e-fixtures] created Auth identity ${email}`);
} else {
  // Align the password with what the specs will present; a database that
  // survived from an earlier run may hold a different one.
  const updated = await admin.auth.admin.updateUserById(user.id, {
    password: PASSWORD,
    email_confirm: true,
  });
  if (updated.error) {
    fail(`could not reset the seeded password: ${updated.error.message}`);
  }
  console.log(`[seed-e2e-fixtures] reused Auth identity ${email}`);
}

const { data: membership } = await admin
  .from("workspace_memberships")
  .select("id,status")
  .eq("profile_id", user.id)
  .eq("status", "active")
  .maybeSingle();

if (!membership) {
  const { error } = await admin.rpc("setup_family", {
    p_user_id: user.id,
    p_email: email,
    p_display_name: DISPLAY_NAME,
    p_workspace_name: WORKSPACE_NAME,
  });
  // `setup closed` means a workspace already exists but this identity does not
  // own it — a reset was skipped somewhere. Say so plainly instead of leaving a
  // half-seeded database that fails later with a confusing sign-in error.
  if (error) {
    fail(
      error.message.includes("setup closed")
        ? "a workspace already exists and is owned by someone else; run `pnpm db:reset` before seeding."
        : `setup_family failed: ${error.message}`,
    );
  }
  console.log(`[seed-e2e-fixtures] created workspace "${WORKSPACE_NAME}"`);
} else {
  console.log("[seed-e2e-fixtures] active membership already present");
}

// Emitted for the caller to export. Written to $GITHUB_ENV when present so the
// CI step needs no parsing.
const assignments = [
  `E2E_PLAID_MEMBER_EMAIL=${email}`,
  `E2E_PLAID_MEMBER_PASSWORD=${PASSWORD}`,
  `E2E_AUTH_OWNER_EMAIL=${email}`,
  `E2E_AUTH_OWNER_PASSWORD=${PASSWORD}`,
];

if (process.env.GITHUB_ENV) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_ENV, `${assignments.join("\n")}\n`);
  console.log(
    "[seed-e2e-fixtures] exported fixture credentials to $GITHUB_ENV",
  );
} else {
  console.log("\nExport these to provision the dependent fixture families:\n");
  for (const assignment of assignments) console.log(`  ${assignment}`);
}
