import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const scriptPath = join(repoRoot, "scripts", "seed-e2e-financial-fixtures.mjs");
const identityScriptPath = join(repoRoot, "scripts", "seed-e2e-fixtures.mjs");

describe("seed-e2e-financial-fixtures CLI safety", () => {
  it("CLI-001 refuses a hosted Supabase URL before attempting database work", () => {
    const serviceRoleSentinel = "service-role-secret-must-not-be-printed";
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: "https://hosted-project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleSentinel,
      },
      timeout: 5_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /refus(?:e|es|ed|ing).*non-loopback Supabase/i,
    );
    expect(result.stderr).toContain("hosted-project.supabase.co");
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      serviceRoleSentinel,
    );
  });

  it("keeps its placeholder-token Item outside the active sync inventory", () => {
    const source = readFileSync(scriptPath, "utf8");
    const itemUpsert = source.match(
      /reconciling the fixture Plaid Item[\s\S]*?reconciling the fixture accounts/,
    )?.[0];

    expect(itemUpsert).toBeDefined();
    expect(itemUpsert).toMatch(/status:\s*"pending"/);
    expect(itemUpsert).not.toMatch(/status:\s*"active"/);
  });

  it("requires caller-provided seed passwords instead of committing a default", () => {
    for (const path of [identityScriptPath, scriptPath]) {
      const source = readFileSync(path, "utf8");
      expect(source).toMatch(/env\("E2E_SEED_PASSWORD"\)/);
      expect(source).not.toMatch(/env\("E2E_SEED_PASSWORD"\)\s*\?\?/);
      expect(source).toMatch(/E2E_SEED_PASSWORD must be set/);
    }
  });
});
