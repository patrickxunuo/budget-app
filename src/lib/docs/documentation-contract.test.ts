import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const REQUIRED_FILES = [
  "README.md",
  "docs/deployment.md",
  "docs/operations.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".env.example",
  ".gitattributes",
  "docs/screenshots/landing.png",
  "docs/screenshots/install.png",
] as const;

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function expectTerms(content: string, terms: RegExp[]): void {
  const normalizedContent = content.replace(/\s+/g, " ");
  for (const term of terms) {
    expect(
      normalizedContent,
      `Expected documentation to match ${term}`,
    ).toMatch(term);
  }
}

function localMarkdownTargets(markdownPath: string): string[] {
  const markdown = read(markdownPath);
  const baseDirectory = dirname(resolve(ROOT, markdownPath));
  const targets: string[] = [];
  const linkPattern =
    /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g;

  for (const match of markdown.matchAll(linkPattern)) {
    const linkTarget = match[1] ?? match[2];
    if (!linkTarget) {
      continue;
    }
    const rawTarget = linkTarget.split(/[?#]/, 1)[0];
    if (
      !rawTarget ||
      rawTarget.startsWith("#") ||
      /^[a-z][a-z\d+.-]*:/i.test(rawTarget)
    ) {
      continue;
    }

    targets.push(resolve(baseDirectory, decodeURIComponent(rawTarget)));
  }

  return targets;
}

function relativeFromRoot(absolutePath: string): string {
  return absolutePath.slice(ROOT.length + 1).replaceAll("\\", "/");
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function expectDocumentationScreenshot(relativePath: string): void {
  const image = readFileSync(resolve(ROOT, relativePath));
  expect(image.subarray(0, pngSignature.length)).toEqual(pngSignature);
  expect(image.length).toBeGreaterThan(10_000);
  expect(image.readUInt32BE(16)).toBeGreaterThanOrEqual(1_200);
  expect(image.readUInt32BE(20)).toBeGreaterThanOrEqual(700);
}

describe("GH-15 open-source deployment documentation contract", () => {
  it("DOC-001 provides the complete repository documentation inventory", () => {
    for (const relativePath of REQUIRED_FILES) {
      expect(
        existsSync(resolve(ROOT, relativePath)),
        `${relativePath} is missing`,
      ).toBe(true);
    }

    const readmeTargets = new Set(
      localMarkdownTargets("README.md").map(relativeFromRoot),
    );
    for (const expectedTarget of [
      "docs/deployment.md",
      "docs/operations.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "docs/screenshots/landing.png",
      "docs/screenshots/install.png",
    ]) {
      expect(
        readmeTargets.has(expectedTarget),
        `README.md must link to ${expectedTarget}`,
      ).toBe(true);
    }
  });

  it("DOC-002 documents product, privacy, and administrator trust boundaries", () => {
    const documentation = `${read("README.md")}\n${read("docs/operations.md")}`;

    expectTerms(documentation, [
      /Canada/i,
      /\bCAD\b/,
      /read[- ]only/i,
      /(?:cannot|can(?:not|'t)|does not|never).{0,80}(?:transfer|payment|financial transaction)/i,
      /Family.{0,160}Personal|Personal.{0,160}Family/i,
      /(?:isolat|separat|private|privacy)/i,
      /(?:infrastructure|hosting|database) administrator/i,
      /(?:access|read|view).{0,100}(?:database|secret)/i,
    ]);
  });

  it("DOC-003 identifies the supported v1 deployment and rejects bundled Docker", () => {
    const deployment = read("docs/deployment.md");

    expectTerms(deployment, [
      /\bVercel\b/i,
      /hosted Supabase/i,
      /user[- ]owned.{0,60}Supabase/i,
      /user[- ]owned.{0,60}Plaid/i,
      /(?:bundled|self[- ]hosted).{0,80}(?:Supabase|Docker)|(?:Supabase|Docker).{0,80}(?:bundled|self[- ]hosted)/i,
      /(?:unsupported|not supported)/i,
      /\bv1\b/i,
    ]);
  });

  it("DOC-004 covers secure hosted Supabase setup and recovery ownership", () => {
    const deployment = read("docs/deployment.md");

    expectTerms(deployment, [
      /(?:create|creation).{0,80}Supabase.{0,40}project/i,
      /supabase\s+link|supabase\s+db\s+push/i,
      /site URL/i,
      /redirect URL/i,
      /30[- ]day/i,
      /session/i,
      /custom SMTP/i,
      /password recover/i,
      /backup/i,
      /restore/i,
      /(?:operator|owner|administrator|you).{0,100}(?:responsib|owns?).{0,100}(?:backup|restore)|(?:backup|restore).{0,100}(?:responsib|owns?)/i,
    ]);
  });

  it("DOC-005 covers Plaid environments, products, webhooks, and OAuth redirects", () => {
    const deployment = read("docs/deployment.md");

    expectTerms(deployment, [
      /\bSandbox\b/i,
      /\bTrial\b/i,
      /\bProduction\b/i,
      /\bCanada\b/i,
      /Transactions[- ]only|only.{0,30}Transactions/i,
      /webhook URL/i,
      /\/accounts/,
      /HTTPS/i,
      /APP_URL/,
      /\/link\/token\/create/,
      /INVALID_FIELD/,
      /local.{0,80}HTTP.{0,120}(?:cannot|can't|unsupported|not supported).{0,80}OAuth/i,
    ]);
  });

  it("DOC-006 covers Vercel configuration, separate migrations, and cron auth", () => {
    const deployment = read("docs/deployment.md");

    expectTerms(deployment, [
      /Vercel.{0,100}environment variable|environment variable.{0,100}Vercel/i,
      /migration.{0,120}(?:separate|independent|not deployed)|(?:separate|independent).{0,120}migration/i,
      /nightly/i,
      /\/api\/internal\/plaid-sync/,
      /CRON_SECRET/,
      /(?:distinct|different|separate).{0,80}CRON_SECRET|CRON_SECRET.{0,80}(?:distinct|different|separate)/i,
      /(?:Bearer|Authorization)/i,
    ]);
  });

  it("DOC-007 supplies the complete runtime ownership and troubleshooting runbook", () => {
    const operations = read("docs/operations.md");

    expectTerms(operations, [
      /first owner|claim.{0,40}owner/i,
      /invite link/i,
      /Family/i,
      /Personal/i,
      /backup/i,
      /restore/i,
      /repair/i,
      /disconnect/i,
      /CSV export|export.{0,30}CSV/i,
      /remove.{0,50}member|member.{0,50}remov/i,
      /delete.{0,50}workspace|workspace.{0,50}delet/i,
      /irreversible/i,
      /webhook/i,
      /stale data/i,
      /Plaid Item/i,
      /login error|ITEM_LOGIN_REQUIRED/i,
      /SMTP/i,
      /password recover/i,
      /PWA/i,
      /install/i,
      /update/i,
      /non[- ]CAD|unsupported.{0,50}(?:account|currency)/i,
    ]);
  });

  it("DOC-008 keeps the environment example complete and safe", () => {
    const envExample = read(".env.example");
    const schemaVariables = [
      "APP_URL",
      "CRON_SECRET",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "PLAID_CLIENT_ID",
      "PLAID_ENV",
      "PLAID_SECRET",
      "PLAID_TOKEN_ENCRYPTION_KEY",
      "PLAID_WEBHOOK_URL",
      "PLAID_E2E_PROVIDER",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SMTP_URL",
      "SMTP_FROM",
    ];

    for (const variable of schemaVariables) {
      expect(envExample, `.env.example must document ${variable}`).toMatch(
        new RegExp(`^#?\\s*${variable}=`, "m"),
      );
    }

    expectTerms(envExample, [
      /Public values|browser bundle/i,
      /server[- ]only|Never expose.{0,80}browser/i,
      /PLAID_TOKEN_ENCRYPTION_KEY/,
      /rotat.{0,120}(?:encrypt|token|data)|(?:encrypt|token|data).{0,120}rotat/i,
    ]);
    expect(envExample).not.toMatch(/eyJ[a-zA-Z\d_-]{20,}\.[a-zA-Z\d_-]{20,}/);
    expect(envExample).not.toMatch(
      /(?:sk|secret|key)[_-](?:live|prod)[_-][a-zA-Z\d]{16,}/i,
    );
  });

  it("DOC-009 uses repository commands and private security reporting", () => {
    const contributing = read("CONTRIBUTING.md");
    const security = read("SECURITY.md");
    const packageJson = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const documentedScripts = [
      "format:check",
      "lint",
      "typecheck",
      "test",
      "test:db",
      "build",
      "test:e2e",
      "smoke:plaid",
    ];

    for (const script of documentedScripts) {
      expect(
        packageJson.scripts[script],
        `package.json is missing ${script}`,
      ).toBeTypeOf("string");
      expect(
        contributing,
        `CONTRIBUTING.md must use the pnpm ${script} command`,
      ).toContain(`pnpm ${script}`);
    }

    expectTerms(contributing, [
      /pnpm install --frozen-lockfile/,
      /pull request/i,
      /release checklist/i,
    ]);
    expectTerms(security, [
      /GitHub Security Advisor(?:y|ies)/i,
      /private/i,
      /(?:do not|don't|never).{0,60}(?:public issue|GitHub issue)|(?:public issue|GitHub issue).{0,60}(?:do not|don't|never)/i,
      /supported version/i,
      /response/i,
      /secret/i,
      /(?:infrastructure|hosting|database) administrator/i,
    ]);
  });

  it("DOC-010 enforces LF normalization and resolves every local README asset", () => {
    expect(read(".gitattributes").trim()).toBe("* text=auto eol=lf");

    const localTargets = localMarkdownTargets("README.md");
    expect(localTargets.length).toBeGreaterThan(0);
    for (const absoluteTarget of localTargets) {
      expect(
        absoluteTarget.startsWith(`${ROOT}\\`) ||
          absoluteTarget.startsWith(`${ROOT}/`),
        `README local reference escapes the repository: ${absoluteTarget}`,
      ).toBe(true);
      expect(
        existsSync(absoluteTarget),
        `README local reference is missing: ${relativeFromRoot(absoluteTarget)}`,
      ).toBe(true);
    }

    for (const screenshot of [
      "docs/screenshots/landing.png",
      "docs/screenshots/install.png",
    ]) {
      expect(extname(screenshot)).toBe(".png");
      expectDocumentationScreenshot(screenshot);
    }
  });
});
