import { expect, test } from "@playwright/test";

/**
 * The single manifest of what each browser journey needs from the environment.
 *
 * Before GH-14 every spec read `process.env.E2E_*` for itself and skipped when
 * a value was absent. A skip is indistinguishable from a pass in the summary
 * line, so a green run could mean 96 of 132 cases never executed. This module
 * keeps the skips (an unprovisioned family is a real, expected local state) but
 * makes them opt-in failures: name a family in `E2E_REQUIRED_FIXTURES` and a
 * missing fixture fails the spec with the exact variables it wanted, and the
 * end-of-run inventory says what did and did not run either way.
 */
export type FixtureFamily =
  | "auth-owner"
  | "auth-member"
  | "auth-invites"
  | "auth-setup"
  | "auth-expired-session"
  | "plaid"
  | "plaid-repair"
  | "plaid-connection"
  | "plaid-connection-destructive"
  | "categories"
  | "categories-transaction"
  | "dashboard"
  | "budgets"
  | "budgets-service-cleanup"
  | "manual-entries"
  | "data-lifecycle"
  | "data-lifecycle-owner"
  | "data-lifecycle-destructive"
  | "data-lifecycle-workspace-destructive";

/**
 * One environment value a family depends on.
 *
 * `candidates` is the fallback chain in the order the specs wrote it, and it is
 * resolved with `??` semantics on purpose: the first *defined* variable wins,
 * even when it is empty. Falling through an explicitly-empty override would
 * quietly change which credentials a spec accepts.
 */
type FixtureSlot = {
  /** Stable key used by `fixtureCredentials` / `fixtureEnv`. */
  readonly name: string;
  readonly candidates: readonly string[];
  /** Flag-style gates: the resolved value must equal this exactly. */
  readonly equals?: string;
};

type FixtureDefinition = {
  /** Carries the information the spec's own skip reason used to carry. */
  readonly summary: string;
  readonly slots: readonly FixtureSlot[];
};

/**
 * The deterministic Plaid adapter is a toggle, not an addition: it is rejected
 * unless Plaid is in Sandbox, so both values are part of the fixture.
 */
const DETERMINISTIC_PLAID: readonly FixtureSlot[] = [
  {
    name: "provider",
    candidates: ["PLAID_E2E_PROVIDER"],
    equals: "deterministic",
  },
  { name: "environment", candidates: ["PLAID_ENV"], equals: "sandbox" },
];

const PLAID_MEMBER: readonly FixtureSlot[] = [
  { name: "email", candidates: ["E2E_PLAID_MEMBER_EMAIL"] },
  { name: "password", candidates: ["E2E_PLAID_MEMBER_PASSWORD"] },
];

/**
 * No fallback to E2E_PLAID_MEMBER_*, deliberately. These journeys need a member
 * who already has an activated, managed, multi-account Item — FE-001 asserts a
 * connection dossier request returns 200 — and `scripts/seed-e2e-fixtures.mjs`
 * seeds an identity, not a linked Item. With the fallback, seeding marked the
 * family provisioned and the journeys then failed on an empty dossier.
 */
const PLAID_CONNECTION_MEMBER: readonly FixtureSlot[] = [
  { name: "email", candidates: ["E2E_PLAID_CONNECTION_MEMBER_EMAIL"] },
  { name: "password", candidates: ["E2E_PLAID_CONNECTION_MEMBER_PASSWORD"] },
];

const CATEGORIES_MEMBER: readonly FixtureSlot[] = [
  {
    name: "email",
    candidates: ["E2E_CATEGORIES_MEMBER_EMAIL", "E2E_PLAID_MEMBER_EMAIL"],
  },
  {
    name: "password",
    candidates: ["E2E_CATEGORIES_MEMBER_PASSWORD", "E2E_PLAID_MEMBER_PASSWORD"],
  },
];

const DATA_LIFECYCLE_OWNER: readonly FixtureSlot[] = [
  { name: "email", candidates: ["E2E_DATA_LIFECYCLE_OWNER_EMAIL"] },
  { name: "password", candidates: ["E2E_DATA_LIFECYCLE_OWNER_PASSWORD"] },
];

const ALLOW_DESTRUCTIVE: FixtureSlot = {
  name: "allowDestructive",
  candidates: ["E2E_DATA_LIFECYCLE_ALLOW_DESTRUCTIVE"],
  equals: "1",
};

const FIXTURES: Readonly<Record<FixtureFamily, FixtureDefinition>> = {
  "auth-owner": {
    summary: "Requires live owner credentials.",
    slots: [
      { name: "email", candidates: ["E2E_AUTH_OWNER_EMAIL"] },
      { name: "password", candidates: ["E2E_AUTH_OWNER_PASSWORD"] },
    ],
  },
  "auth-member": {
    summary: "Requires live member credentials.",
    slots: [
      { name: "email", candidates: ["E2E_AUTH_MEMBER_EMAIL"] },
      { name: "password", candidates: ["E2E_AUTH_MEMBER_PASSWORD"] },
    ],
  },
  "auth-invites": {
    summary:
      "Requires valid, expired, revoked, and replayed invite fixtures in the live Supabase test project.",
    slots: [
      { name: "valid", candidates: ["E2E_AUTH_VALID_INVITE_TOKEN"] },
      { name: "expired", candidates: ["E2E_AUTH_EXPIRED_INVITE_TOKEN"] },
      { name: "revoked", candidates: ["E2E_AUTH_REVOKED_INVITE_TOKEN"] },
      { name: "replayed", candidates: ["E2E_AUTH_REPLAYED_INVITE_TOKEN"] },
    ],
  },
  "auth-setup": {
    summary:
      "Requires an isolated, empty Supabase project and E2E_AUTH_ALLOW_SETUP=1.",
    slots: [
      {
        name: "allowSetup",
        candidates: ["E2E_AUTH_ALLOW_SETUP"],
        equals: "1",
      },
    ],
  },
  "auth-expired-session": {
    summary:
      "Requires E2E_AUTH_EXPIRED_SESSION_COOKIES from a live user whose absolute session start is over 30 days old.",
    slots: [
      { name: "cookies", candidates: ["E2E_AUTH_EXPIRED_SESSION_COOKIES"] },
    ],
  },
  plaid: {
    summary:
      "Requires PLAID_E2E_PROVIDER=deterministic in Sandbox and an active member with an activated Item via E2E_PLAID_MEMBER_* credentials.",
    slots: [...DETERMINISTIC_PLAID, ...PLAID_MEMBER],
  },
  "plaid-repair": {
    summary:
      "Requires E2E_PLAID_REPAIR_STATE=1 with the member Item seeded in login-repair or expiring-consent state.",
    slots: [
      ...DETERMINISTIC_PLAID,
      ...PLAID_MEMBER,
      {
        name: "repairState",
        candidates: ["E2E_PLAID_REPAIR_STATE"],
        equals: "1",
      },
    ],
  },
  "plaid-connection": {
    summary:
      "Requires deterministic Plaid Sandbox and an active linker with a managed multi-account Item.",
    slots: [...DETERMINISTIC_PLAID, ...PLAID_CONNECTION_MEMBER],
  },
  "plaid-connection-destructive": {
    summary:
      "Set E2E_PLAID_CONNECTION_DESTRUCTIVE=1 with a disposable Item to exercise disconnect.",
    slots: [
      ...DETERMINISTIC_PLAID,
      ...PLAID_CONNECTION_MEMBER,
      {
        name: "destructive",
        candidates: ["E2E_PLAID_CONNECTION_DESTRUCTIVE"],
        equals: "1",
      },
    ],
  },
  categories: {
    summary:
      "Requires an active member via E2E_CATEGORIES_MEMBER_* or E2E_PLAID_MEMBER_* credentials.",
    slots: CATEGORIES_MEMBER,
  },
  "categories-transaction": {
    summary:
      "Requires an active member via E2E_CATEGORIES_MEMBER_* or E2E_PLAID_MEMBER_* credentials, plus E2E_CATEGORIES_TRANSACTION_FIXTURE=1 with at least one visible imported transaction.",
    slots: [
      ...CATEGORIES_MEMBER,
      {
        name: "transactionFixture",
        candidates: ["E2E_CATEGORIES_TRANSACTION_FIXTURE"],
        equals: "1",
      },
    ],
  },
  // Dashboard credentials are emitted only by the financial seed. The identity
  // seed cannot provision this family because these journeys assert real Family
  // balances, freshness, current-month spending, and budget progress.
  dashboard: {
    summary:
      "Requires the deterministic Family accounts, transaction, and current-month budget created by pnpm seed:e2e:financial, plus E2E_DASHBOARD_MEMBER_* credentials.",
    slots: [
      { name: "email", candidates: ["E2E_DASHBOARD_MEMBER_EMAIL"] },
      { name: "password", candidates: ["E2E_DASHBOARD_MEMBER_PASSWORD"] },
    ],
  },
  budgets: {
    summary:
      "Requires an active member with budget categories, progress thresholds, and Family/Personal fixtures via E2E_BUDGET_MEMBER_* credentials.",
    slots: [
      { name: "email", candidates: ["E2E_BUDGET_MEMBER_EMAIL"] },
      { name: "password", candidates: ["E2E_BUDGET_MEMBER_PASSWORD"] },
    ],
  },
  "budgets-service-cleanup": {
    summary:
      "Mutating budget journeys require runtime Supabase URL/service-role credentials for deterministic test-only cleanup.",
    slots: [
      { name: "supabaseUrl", candidates: ["NEXT_PUBLIC_SUPABASE_URL"] },
      { name: "serviceRoleKey", candidates: ["SUPABASE_SERVICE_ROLE_KEY"] },
    ],
  },
  // The identity seed provisions this family. Its journeys create and clean up
  // uniquely named rows in each explicit URL ledger scope against real APIs.
  "manual-entries": {
    summary:
      "Requires the active owner created by pnpm seed:e2e via E2E_MANUAL_ENTRY_MEMBER_* credentials; each journey owns its scoped categories and entries.",
    slots: [
      { name: "email", candidates: ["E2E_MANUAL_ENTRY_MEMBER_EMAIL"] },
      { name: "password", candidates: ["E2E_MANUAL_ENTRY_MEMBER_PASSWORD"] },
    ],
  },
  "data-lifecycle": {
    summary:
      "Requires GH-12 real-backend fixture credentials via E2E_DATA_LIFECYCLE_*.",
    slots: [
      { name: "email", candidates: ["E2E_DATA_LIFECYCLE_MEMBER_EMAIL"] },
      { name: "password", candidates: ["E2E_DATA_LIFECYCLE_MEMBER_PASSWORD"] },
    ],
  },
  "data-lifecycle-owner": {
    summary:
      "Requires GH-12 real-backend fixture credentials via E2E_DATA_LIFECYCLE_*.",
    slots: DATA_LIFECYCLE_OWNER,
  },
  "data-lifecycle-destructive": {
    summary:
      "Requires an explicitly disposable member fixture with an Item configured to return an unconfirmed revocation.",
    slots: [
      ALLOW_DESTRUCTIVE,
      {
        name: "email",
        candidates: ["E2E_DATA_LIFECYCLE_DISPOSABLE_MEMBER_EMAIL"],
      },
      {
        name: "password",
        candidates: ["E2E_DATA_LIFECYCLE_DISPOSABLE_MEMBER_PASSWORD"],
      },
    ],
  },
  "data-lifecycle-workspace-destructive": {
    summary:
      "Requires an explicitly disposable owner/workspace fixture and E2E_DATA_LIFECYCLE_ALLOW_DESTRUCTIVE=1.",
    slots: [
      ALLOW_DESTRUCTIVE,
      ...DATA_LIFECYCLE_OWNER,
      {
        name: "workspaceName",
        candidates: ["E2E_DATA_LIFECYCLE_DISPOSABLE_WORKSPACE_NAME"],
      },
    ],
  },
};

const FIXTURE_FAMILIES = Object.keys(FIXTURES) as FixtureFamily[];

/** The env var that turns a silent skip into a failure. */
export const REQUIRED_FIXTURES_VARIABLE = "E2E_REQUIRED_FIXTURES";

/** `??` semantics: the first *defined* candidate wins, even when it is empty. */
function resolveSlot(slot: FixtureSlot): string | undefined {
  for (const candidate of slot.candidates) {
    const value = process.env[candidate];
    if (value !== undefined) return value;
  }
  return undefined;
}

function isSlotSatisfied(slot: FixtureSlot, value: string | undefined) {
  if (slot.equals !== undefined) return value === slot.equals;
  return Boolean(value);
}

/** `E2E_PLAID_MEMBER_EMAIL`, `A or B`, `PLAID_ENV=sandbox`. */
function describeSlot(slot: FixtureSlot): string {
  const suffix = slot.equals === undefined ? "" : `=${slot.equals}`;
  return slot.candidates.map((candidate) => candidate + suffix).join(" or ");
}

let requiredFamilies: ReadonlySet<FixtureFamily> | undefined;

/**
 * Parses `E2E_REQUIRED_FIXTURES`. A typo would silently restore the very
 * false confidence this module exists to remove, so an unknown name throws.
 */
function readRequiredFamilies(): ReadonlySet<FixtureFamily> {
  if (requiredFamilies) return requiredFamilies;
  const raw = process.env[REQUIRED_FIXTURES_VARIABLE] ?? "";
  const names = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (names.includes("all")) {
    requiredFamilies = new Set(FIXTURE_FAMILIES);
    return requiredFamilies;
  }

  const selected = new Set<FixtureFamily>();
  for (const name of names) {
    const family = FIXTURE_FAMILIES.find((candidate) => candidate === name);
    if (!family) {
      throw new Error(
        `${REQUIRED_FIXTURES_VARIABLE} names an unknown fixture family "${name}". Known families: ${FIXTURE_FAMILIES.join(", ")}, or "all".`,
      );
    }
    selected.add(family);
  }
  requiredFamilies = selected;
  return requiredFamilies;
}

/** Every declared variable of the family that is absent or has the wrong value. */
export function fixtureMissingVariables(family: FixtureFamily): string[] {
  return FIXTURES[family].slots
    .filter((slot) => !isSlotSatisfied(slot, resolveSlot(slot)))
    .map(describeSlot);
}

/** True when every variable the family declares is present and correct. */
export function isFixtureProvisioned(family: FixtureFamily): boolean {
  return fixtureMissingVariables(family).length === 0;
}

/**
 * Raw resolved values by slot name, whether or not the family is provisioned.
 * Specs that read a fixture value *without* gating on it (an optional extra
 * assertion) need this; anything that gates should use `requireFixture` first.
 */
export function fixtureEnv(
  family: FixtureFamily,
): Readonly<Record<string, string | undefined>> {
  const resolved: Record<string, string | undefined> = {};
  for (const slot of FIXTURES[family].slots) {
    resolved[slot.name] = resolveSlot(slot);
  }
  return resolved;
}

/** Resolved credentials for a family, or undefined when it is not provisioned. */
export function fixtureCredentials(
  family: FixtureFamily,
): { email: string; password: string } | undefined {
  if (!isFixtureProvisioned(family)) return undefined;
  const resolved = fixtureEnv(family);
  const email = resolved.email;
  const password = resolved.password;
  if (!email || !password) return undefined;
  return { email, password };
}

function missingFixtureMessage(family: FixtureFamily): string {
  const missing = fixtureMissingVariables(family);
  return `Fixture family "${family}" is not provisioned. ${FIXTURES[family].summary} Missing: ${missing.join(", ")}. Set ${REQUIRED_FIXTURES_VARIABLE} to include "${family}" (or "all") to make this a failure instead of a skip.`;
}

/**
 * Gate a spec on a fixture family. Skips when the family is absent and
 * optional; FAILS when the family is named in `E2E_REQUIRED_FIXTURES`, so
 * missing coverage is visible rather than silent.
 */
export function requireFixture(family: FixtureFamily): void {
  if (isFixtureProvisioned(family)) return;
  const message = missingFixtureMessage(family);
  if (readRequiredFamilies().has(family)) {
    expect(fixtureMissingVariables(family), message).toEqual([]);
    return;
  }
  test.skip(true, message);
}

/** Machine-readable inventory used by the end-of-run coverage reporter. */
export function fixtureInventory(): {
  family: FixtureFamily;
  provisioned: boolean;
  required: boolean;
  missing: string[];
}[] {
  const required = readRequiredFamilies();
  return FIXTURE_FAMILIES.map((family) => {
    const missing = fixtureMissingVariables(family);
    return {
      family,
      provisioned: missing.length === 0,
      required: required.has(family),
      missing,
    };
  });
}

/**
 * Prints the inventory so a reader of the run log can tell what did not run.
 *
 * Called once from `e2e/support/global-teardown.ts`, which `playwright.config.ts`
 * registers as the run's `globalTeardown`. It was briefly driven from a
 * `test.afterAll` instead; that fires once per Playwright project and, under
 * `fullyParallel`, once per worker that touched the file, so the inventory
 * printed several times and each copy read like a separate verdict. `label`
 * survives for callers that still want to distinguish a partial run.
 *
 * Written with `console.log` so it lands in the `list` reporter output.
 */
export function reportFixtureInventory(label?: string): void {
  const inventory = fixtureInventory();
  const provisioned = inventory.filter((entry) => entry.provisioned);
  const heading = label
    ? `E2E fixture inventory (${label})`
    : "E2E fixture inventory";
  const lines = [
    "",
    heading,
    "=".repeat(heading.length),
    `${provisioned.length}/${inventory.length} families provisioned. ${REQUIRED_FIXTURES_VARIABLE}=${process.env[REQUIRED_FIXTURES_VARIABLE] ?? "(unset)"}`,
    "",
  ];
  for (const entry of inventory) {
    const state = entry.provisioned ? "provisioned" : "ABSENT     ";
    const requirement = entry.required ? "required" : "optional";
    const detail = entry.provisioned
      ? ""
      : ` — missing ${entry.missing.join(", ")}`;
    lines.push(`  ${state}  ${requirement}  ${entry.family}${detail}`);
  }
  lines.push("");
  console.log(lines.join("\n"));
}

/**
 * Safety net for the one hole `requireFixture` alone cannot close: when a
 * required family sits behind an outer, unprovisioned gate, its own
 * `requireFixture` call is never reached because the outer `test.skip` already
 * aborted the test. Asserting the whole inventory at the end of the run makes a
 * required-but-absent family fail no matter which gate swallowed it.
 */
export function assertRequiredFixturesProvisioned(): void {
  const unmet = fixtureInventory().filter(
    (entry) => entry.required && !entry.provisioned,
  );
  expect(
    unmet.map(
      (entry) => `${entry.family} (missing ${entry.missing.join(", ")})`,
    ),
    `${REQUIRED_FIXTURES_VARIABLE} names fixture families that are not provisioned, so the journeys they gate never ran.`,
  ).toEqual([]);
}
