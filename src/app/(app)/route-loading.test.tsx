import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RootLoading from "../loading";
import AccountsLoading from "./accounts/loading";
import BudgetsLoading from "./budgets/loading";
import CategoriesLoading from "./categories/loading";
import DashboardLoading from "./dashboard/loading";
import MembersLoading from "./settings/members/loading";
import TransactionsLoading from "./transactions/loading";
import ManualTransactionsLoading from "./transactions/manual/loading";
import PlaidTransactionsLoading from "./transactions/plaid/loading";

const REPO_ROOT = process.cwd();
const MONEY = /\$\s?\d|\d+\.\d{2}/;
const FIGURE = /\d/;
const CURRENCY_SYMBOL = /[$€£¥]/;
const FABRICATED_NAME =
  /\b(chequing|checking|savings|visa|mastercard|amex|rbc|scotiabank|tangerine|wealthsimple|groceries|dining|restaurants?|rent|mortgage|payroll|utilities|starbucks|amazon|uber|walmart|costco|netflix|spotify)\b/i;
const REMOVED_EDITORIAL =
  /secure custody|connection dossier|connected & in hand|every dollar has a margin|monthly allocation ledger|set the line|classification \/ household index|give every dollar a place|membership register|household roll|financial field note|at a glance|working margin|cumulative field trace|balance observations/i;

type RouteCase = {
  readonly name: string;
  readonly Loading: ComponentType;
  readonly source: string;
  readonly loadingSource: string;
  readonly regions: number;
};

const ROUTES: readonly RouteCase[] = [
  {
    name: "dashboard",
    Loading: DashboardLoading,
    source: "src/components/dashboard/financial-dashboard.tsx",
    loadingSource: "src/app/(app)/dashboard/loading.tsx",
    regions: 3,
  },
  {
    name: "accounts",
    Loading: AccountsLoading,
    source: "src/app/(app)/accounts/page.tsx",
    loadingSource: "src/app/(app)/accounts/loading.tsx",
    regions: 3,
  },
  {
    name: "transactions",
    Loading: TransactionsLoading,
    source: "src/app/(app)/transactions/page.tsx",
    loadingSource: "src/app/(app)/transactions/loading.tsx",
    regions: 3,
  },
  {
    name: "transactions/manual",
    Loading: ManualTransactionsLoading,
    source: "src/app/(app)/transactions/manual/page.tsx",
    loadingSource: "src/app/(app)/transactions/manual/loading.tsx",
    regions: 3,
  },
  {
    name: "transactions/plaid",
    Loading: PlaidTransactionsLoading,
    source: "src/app/(app)/transactions/plaid/page.tsx",
    loadingSource: "src/app/(app)/transactions/plaid/loading.tsx",
    regions: 2,
  },
  {
    name: "budgets",
    Loading: BudgetsLoading,
    source: "src/app/(app)/budgets/page.tsx",
    loadingSource: "src/app/(app)/budgets/loading.tsx",
    regions: 2,
  },
  {
    name: "categories",
    Loading: CategoriesLoading,
    source: "src/app/(app)/categories/page.tsx",
    loadingSource: "src/app/(app)/categories/loading.tsx",
    regions: 2,
  },
  {
    name: "settings/members",
    Loading: MembersLoading,
    source: "src/app/(app)/settings/members/page.tsx",
    loadingSource: "src/app/(app)/settings/members/loading.tsx",
    regions: 2,
  },
];

function readRouteLandmark(relativePath: string) {
  const source = readFileSync(join(REPO_ROOT, relativePath), "utf8");
  const openingTag = /<main\b[\s\S]*?>/.exec(source);
  const afterMain = source.slice(
    (openingTag?.index ?? 0) + (openingTag?.[0].length ?? 0),
  );
  return {
    mainClassName: openingTag
      ? /className="([^"]*)"/.exec(openingTag[0])?.[1]
      : undefined,
    containerClassName: /<div className="(mx-auto max-w-[^"]*)">/.exec(
      afterMain,
    )?.[1],
  };
}

function widestPlaceholderRun(root: HTMLElement): number {
  let widest = 0;
  for (const parent of [root, ...root.querySelectorAll("*")]) {
    const run = Array.from(parent.children).filter(
      (child) =>
        child.classList.contains("skeleton") ||
        child.querySelector(".skeleton") !== null,
    ).length;
    if (run > widest) widest = run;
  }
  return widest;
}

function renderRoute(route: RouteCase) {
  render(<route.Loading />);
  return screen.getByTestId("route-skeleton");
}

describe("GH-32 authenticated destination fallbacks", () => {
  it.each(ROUTES)("RL-001 $name keeps the route landmark", (route) => {
    const main = renderRoute(route);
    expect(main.tagName).toBe("MAIN");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveAttribute("aria-busy", "true");
  });

  it.each(ROUTES)("RL-002 $name mirrors compact route geometry", (route) => {
    const main = renderRoute(route);
    const landmark = readRouteLandmark(route.source);
    expect(landmark.mainClassName).toBeTruthy();
    expect(main.getAttribute("class")).toBe(landmark.mainClassName);

    const container = main.querySelector("div");
    expect(landmark.containerClassName).toBeTruthy();
    expect(container?.getAttribute("class")).toBe(landmark.containerClassName);
  });
});

describe("GH-51 compact loading geometry (FE-002, FE-008)", () => {
  it.each(ROUTES)(
    "FE-002 $name has no duplicate h1, editorial copy, or masthead-only source block",
    (route) => {
      const main = renderRoute(route);
      const loadingSource = readFileSync(
        join(REPO_ROOT, route.loadingSource),
        "utf8",
      );

      expect(within(main).queryByRole("heading", { level: 1 })).toBeNull();
      expect(main.textContent ?? "").not.toMatch(REMOVED_EDITORIAL);
      expect(loadingSource).not.toMatch(/text-(?:5|6|7|8|9)xl/);
      if (route.name !== "dashboard") {
        expect(loadingSource).not.toMatch(
          /lg:grid-cols-\[1fr_22rem\]|border-b pb-8/,
        );
      }
    },
  );

  it.each(ROUTES)(
    "FE-002 $name starts with repeated work-surface shapes instead of a masthead",
    (route) => {
      const main = renderRoute(route);
      const shapes = main.querySelectorAll(".skeleton");
      expect(shapes.length).toBeGreaterThanOrEqual(route.regions * 2);
      expect(widestPlaceholderRun(main)).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(ROUTES)(
    "FE-008 $name exposes one empty-mounted busy announcement",
    (route) => {
      const main = renderRoute(route);
      const status = within(main).getByTestId("route-skeleton-status");
      expect(within(main).getAllByRole("status")).toEqual([status]);

      const settledLabel = status.textContent?.trim() ?? "";
      expect(settledLabel).not.toBe("");
      expect(renderToStaticMarkup(<route.Loading />)).not.toContain(
        settledLabel,
      );
    },
  );
});

describe("GH-32 data-free and accessible route skeletons", () => {
  it.each(ROUTES)("RL-008 $name fabricates no financial data", (route) => {
    const main = renderRoute(route);
    const text = main.textContent ?? "";
    expect(text).not.toMatch(MONEY);
    expect(text).not.toMatch(FIGURE);
    expect(text).not.toMatch(CURRENCY_SYMBOL);
    expect(text).not.toMatch(FABRICATED_NAME);

    const shapes = Array.from(main.querySelectorAll(".skeleton"));
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape).toHaveAttribute("aria-hidden", "true");
      expect(shape.textContent).toBe("");
    }
  });

  it("RL-012 gives every destination a distinct loading announcement", () => {
    const labels = ROUTES.map((route) => {
      const { unmount } = render(<route.Loading />);
      const label =
        screen.getByTestId("route-skeleton-status").textContent?.trim() ?? "";
      unmount();
      return label;
    });

    expect(labels.every(Boolean)).toBe(true);
    expect(new Set(labels).size).toBe(ROUTES.length);
  });
});

describe("GH-32 cold-boot root loader", () => {
  it("RL-013 stays distinct from a route skeleton", () => {
    render(<RootLoading />);
    const main = screen.getByTestId("root-loading");
    expect(main.tagName).toBe("MAIN");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("route-skeleton")).not.toBeInTheDocument();
  });

  it("RL-016 mounts its one status empty and invents no data", () => {
    render(<RootLoading />);
    const main = screen.getByTestId("root-loading");
    const status = within(main).getByTestId("route-skeleton-status");
    const label = status.textContent?.trim() ?? "";
    expect(within(main).getAllByRole("status")).toEqual([status]);
    expect(label).not.toBe("");
    expect(renderToStaticMarkup(<RootLoading />)).not.toContain(label);

    const text = main.textContent ?? "";
    expect(text).not.toMatch(MONEY);
    expect(text).not.toMatch(FIGURE);
    expect(text).not.toMatch(CURRENCY_SYMBOL);
    expect(text).not.toMatch(FABRICATED_NAME);
  });
});
