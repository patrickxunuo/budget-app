import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

import { expect, test } from "@playwright/test";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";

const adoptingSurfaces = [
  [
    "transaction-ledger",
    "src/components/transactions/transaction-ledger.tsx",
    "Save category",
    "Saving…",
  ],
  [
    "plaid-connection-manager",
    "src/components/plaid/plaid-connection-manager.tsx",
    "Open secure update",
    "Preparing update…",
  ],
  [
    "budget-workbench",
    "src/components/budgets/budget-workbench.tsx",
    "Save target",
    "Saving…",
  ],
  [
    "category-workbench",
    "src/components/categories/category-workbench.tsx",
    "Create category",
    "Saving…",
  ],
  [
    "manual-entry-workbench",
    "src/components/transactions/manual-entry-workbench.tsx",
    "Record transaction",
    "Recording…",
  ],
] as const;

type BrowserPendingProps = {
  pending: boolean;
  pendingLabel: ReactNode;
  name: string;
  className: string;
  children?: ReactNode;
};

function loadPendingButton() {
  const output = transpileModule(
    readFileSync("src/components/pending-button.tsx", "utf8"),
    {
      compilerOptions: {
        esModuleInterop: true,
        jsx: JsxEmit.ReactJSX,
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const loaded: { exports: Record<string, unknown> } = { exports: {} };
  runInNewContext(output, {
    exports: loaded.exports,
    module: loaded,
    process,
    require: createRequire(`${process.cwd()}/e2e/pending-button.spec.ts`),
  });
  return loaded.exports.PendingButton as ComponentType<BrowserPendingProps>;
}

function surfaceMarkup() {
  const PendingButton = loadPendingButton();
  return adoptingSurfaces
    .map(([surface, , idleLabel, pendingLabel]) => {
      const renderButton = (pending: boolean) =>
        renderToStaticMarkup(
          createElement(
            PendingButton,
            {
              pending,
              pendingLabel,
              name: surface,
              className: "border-line rounded-xl border px-4 py-3",
            },
            idleLabel,
          ),
        );
      return `<section data-surface="${surface}">${renderButton(false)}<template>${renderButton(true)}</template></section>`;
    })
    .join("");
}

test("GH-33 FE-008 keeps every shared pending control stable and removes reduced motion", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /shared money.*clear boundaries/i }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");

  for (const [, sourcePath] of adoptingSurfaces) {
    expect(readFileSync(sourcePath, "utf8")).toContain("<PendingButton");
  }
  const explorerSource = readFileSync(
    "src/components/transactions/transaction-explorer.tsx",
    "utf8",
  );
  expect(explorerSource).toContain('strategy: "latest"');
  expect(explorerSource).toContain('data-testid="transactions-loading"');
  expect(explorerSource).toContain('aria-live="polite"');

  await page.evaluate((markup) => {
    document.body.innerHTML = `<main style="display:grid;gap:1rem;padding:2rem">${markup}<p data-testid="transactions-loading" role="status" aria-live="polite">Updating transaction results…</p></main>`;
  }, surfaceMarkup());

  const results = await page
    .locator("[data-surface]")
    .evaluateAll(async (sections) =>
      Promise.all(
        sections.map(async (section) => {
          const idleButton = section.querySelector("button");
          const idleContent = section.querySelector<HTMLElement>(
            ".pending-button-content",
          );
          const idleLabels = section.querySelectorAll<HTMLElement>(
            ".pending-button-label",
          );
          const template =
            section.querySelector<HTMLTemplateElement>("template");
          if (
            !idleButton ||
            !idleContent ||
            idleLabels.length !== 2 ||
            !template
          )
            throw new Error(
              "PendingButton rendered an unexpected DOM contract.",
            );

          const idle = idleButton.getBoundingClientRect();
          const observed = new Promise<boolean>((resolve) => {
            const observer = new MutationObserver(() => {
              const pendingButton = section.querySelector("button");
              if (
                pendingButton?.getAttribute("aria-busy") === "true" &&
                pendingButton.disabled
              ) {
                observer.disconnect();
                resolve(true);
              }
            });
            observer.observe(section, {
              childList: true,
              subtree: true,
            });
          });

          section.innerHTML = template.innerHTML;
          const pendingObserved = await observed;

          const pendingButton = section.querySelector("button");
          const pendingContent = section.querySelector<HTMLElement>(
            ".pending-button-content",
          );
          const pendingLabels = section.querySelectorAll<HTMLElement>(
            ".pending-button-label",
          );
          const status = section.querySelector<HTMLElement>("[role='status']");
          if (
            !pendingButton ||
            !pendingContent ||
            pendingLabels.length !== 2 ||
            !status?.textContent
          )
            throw new Error("PendingButton did not render its pending state.");
          const pending = pendingButton.getBoundingClientRect();
          const dot = section.querySelector<HTMLElement>(
            ".pending-button-dots i",
          );
          return {
            surface: section.getAttribute("data-surface"),
            observed: pendingObserved,
            idle: { width: idle.width, height: idle.height },
            pending: { width: pending.width, height: pending.height },
            contentDisplay: getComputedStyle(pendingContent).display,
            labelGridAreas: Array.from(
              pendingLabels,
              (label) => getComputedStyle(label).gridArea,
            ),
            animationName: dot ? getComputedStyle(dot).animationName : "",
          };
        }),
      ),
    );

  expect(results.map((result) => result.surface)).toEqual(
    adoptingSurfaces.map(([surface]) => surface),
  );
  for (const result of results) {
    expect(result.observed).toBe(true);
    expect(result.contentDisplay).toBe("inline-grid");
    expect(
      result.labelGridAreas.every((area) => area.startsWith("1 / 1")),
    ).toBe(true);
    expect(Math.abs(result.idle.width - result.pending.width)).toBeLessThan(
      0.1,
    );
    expect(Math.abs(result.idle.height - result.pending.height)).toBeLessThan(
      0.1,
    );
    expect(result.animationName).toBe("pending-button-dot");
  }

  await expect(page.getByTestId("transactions-loading")).toHaveText(
    "Updating transaction results…",
  );
  await expect(page.getByTestId("transactions-loading")).toHaveAttribute(
    "aria-live",
    "polite",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedAnimations = await page
    .locator(".pending-button-dots i")
    .evaluateAll((dots) =>
      dots.map((dot) => getComputedStyle(dot).animationName),
    );
  expect(reducedAnimations).toHaveLength(adoptingSurfaces.length * 3);
  expect(reducedAnimations.every((animation) => animation === "none")).toBe(
    true,
  );

  if (process.env.PAPERPLANE_CAPTURE_SCREENSHOTS === "1") {
    const path = testInfo.outputPath("gh-33-pending-controls.png");
    await page.screenshot({ animations: "disabled", fullPage: true, path });
    await testInfo.attach("GH-33 pending controls", {
      contentType: "image/png",
      path,
    });
  }
});
