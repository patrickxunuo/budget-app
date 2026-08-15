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

// Vitest runs from the directory holding `vitest.config.mts`; `import.meta.url`
// is a Vite transform URL here, not a file one, so it cannot stand in for it.
const REPO_ROOT = process.cwd();

/** Any currency symbol or cents-precision figure — shared with `e2e/pwa.spec.ts`. */
const MONEY = /\$\s?\d|\d+\.\d{2}/;
/** A skeleton has nothing true to count, so any figure at all is fabricated. */
const FIGURE = /\d/;
const CURRENCY_SYMBOL = /[$€£¥]/;
/** Words only real records carry: institutions, merchants, and category labels. */
const FABRICATED_NAME =
  /\b(chequing|checking|savings|visa|mastercard|amex|rbc|scotiabank|tangerine|wealthsimple|groceries|dining|restaurants?|rent|mortgage|payroll|utilities|starbucks|amazon|uber|walmart|costco|netflix|spotify)\b/i;

type RouteCase = {
  readonly name: string;
  readonly Loading: ComponentType;
  /**
   * Where the real route writes the landmark this skeleton has to reproduce.
   * The dashboard's lives in the client component its page renders, not in the
   * page file, which is exactly the kind of thing a hand-copied class drifts on.
   */
  readonly source: string;
  readonly mainClassName: string;
  readonly containerClassName: string;
  /** Regions the acceptance spec says this skeleton mirrors. */
  readonly regions: number;
};

const ROUTES: readonly RouteCase[] = [
  {
    name: "dashboard",
    Loading: DashboardLoading,
    source: "src/components/dashboard/financial-dashboard.tsx",
    mainClassName:
      "min-w-0 overflow-x-hidden px-4 py-6 sm:px-8 sm:py-8 lg:px-12",
    containerClassName: "mx-auto max-w-7xl",
    // compact heading/scope, budget health, comparison chart, account balances.
    regions: 4,
  },
  {
    name: "accounts",
    Loading: AccountsLoading,
    source: "src/app/(app)/accounts/page.tsx",
    mainClassName: "px-5 py-9 sm:px-8 sm:py-11 lg:px-12 lg:py-14",
    containerClassName: "mx-auto max-w-6xl",
    // header, sync-status strip, connection cards, link-flow footer.
    regions: 4,
  },
  {
    name: "transactions",
    Loading: TransactionsLoading,
    source: "src/app/(app)/transactions/page.tsx",
    mainClassName: "px-5 py-9 sm:px-8 lg:px-12 lg:py-14",
    containerClassName: "mx-auto max-w-7xl",
    // header, scope pills, three-cell summary band, manual register, ledger.
    regions: 5,
  },
  {
    name: "budgets",
    Loading: BudgetsLoading,
    source: "src/app/(app)/budgets/page.tsx",
    mainClassName:
      "min-w-0 overflow-x-hidden px-4 py-8 sm:px-8 lg:px-12 lg:py-14",
    containerClassName: "mx-auto max-w-7xl",
    // header, month control strip, category target rows.
    regions: 3,
  },
  {
    name: "categories",
    Loading: CategoriesLoading,
    source: "src/app/(app)/categories/page.tsx",
    mainClassName: "px-5 py-9 sm:px-8 lg:px-12 lg:py-14",
    containerClassName: "mx-auto max-w-6xl",
    // header, category list, rule register.
    regions: 3,
  },
  {
    name: "settings/members",
    Loading: MembersLoading,
    source: "src/app/(app)/settings/members/page.tsx",
    mainClassName: "px-5 py-10 sm:px-8 lg:px-12",
    containerClassName: "mx-auto max-w-5xl",
    // header, roster rows, invitation block.
    regions: 3,
  },
];

/**
 * The landmark and container a real route writes, read out of its source.
 *
 * Comparing against the source rather than a second copy of the strings is the
 * point: the fallback exists so the skip-link target and the page box survive
 * the loading phase, and a padding change on the route that never reaches the
 * skeleton reintroduces the layout shift it was added to prevent.
 */
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

/**
 * The widest run of sibling elements that each hold at least one placeholder.
 *
 * A generic spinner has one shape and no run; a skeleton that mirrors its route
 * has a tiles row, a card list, or a set of ledger rows. Counting siblings
 * keeps the check honest without pinning the markup to one nesting.
 */
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

describe("GH-32 every authenticated destination has its own fallback (AC1, AC6)", () => {
  it.each(ROUTES)(
    "RL-001 $name renders the shared route-skeleton landmark",
    (route) => {
      const main = renderRoute(route);

      expect(main.tagName).toBe("MAIN");
      expect(main).toHaveAttribute("id", "main-content");
      expect(main).toHaveAttribute("tabindex", "-1");
      expect(main).toHaveAttribute("aria-busy", "true");
    },
  );

  it.each(ROUTES)(
    "RL-002 $name reproduces the <main> classes the spec assigns it",
    (route) => {
      expect(renderRoute(route).getAttribute("class")).toBe(
        route.mainClassName,
      );
    },
  );

  it.each(ROUTES)(
    "RL-003 $name reproduces the container the spec assigns it",
    (route) => {
      const container = renderRoute(route).querySelector("div");

      expect(container?.getAttribute("class")).toBe(route.containerClassName);
    },
  );
});

describe("GH-32 the skeleton cannot drift from the route it mirrors (AC6)", () => {
  it.each(ROUTES)(
    "RL-004 $name matches the <main> classes written in $source",
    (route) => {
      const landmark = readRouteLandmark(route.source);

      // Guard the guard: a regex that stops matching would otherwise turn this
      // into `undefined === undefined` and pass while proving nothing.
      expect(landmark.mainClassName).toBeTruthy();
      expect(landmark.mainClassName).toBe(route.mainClassName);
    },
  );

  it.each(ROUTES)(
    "RL-005 $name matches the container written in $source",
    (route) => {
      const landmark = readRouteLandmark(route.source);

      expect(landmark.containerClassName).toBeTruthy();
      expect(landmark.containerClassName).toBe(route.containerClassName);
    },
  );
});

describe("GH-32 a skeleton mirrors its route rather than spinning (AC5)", () => {
  it.each(ROUTES)(
    "RL-006 $name carries at least two placeholders per region it mirrors",
    (route) => {
      const shapes = renderRoute(route).querySelectorAll(".skeleton");

      expect(shapes.length).toBeGreaterThanOrEqual(route.regions * 2);
    },
  );

  it.each(ROUTES)(
    "RL-007 $name lays its placeholders out as repeated rows, tiles, or cards",
    (route) => {
      // Every one of the six has at least one repeating region — tiles,
      // connection cards, ledger rows, target rows, a category list, a roster.
      expect(widestPlaceholderRun(renderRoute(route))).toBeGreaterThanOrEqual(
        3,
      );
    },
  );
});

describe("GH-32 no skeleton invents a figure or a name (AC7)", () => {
  it.each(ROUTES)("RL-008 $name shows no fabricated data", (route) => {
    const text = renderRoute(route).textContent ?? "";

    // The GH-13 offline-screen check in `e2e/pwa.spec.ts` in component form: a
    // placeholder that reads like data is worse than an empty box, because a
    // member cannot tell the difference until it changes under them.
    expect(text).not.toMatch(MONEY);
    expect(text).not.toMatch(FIGURE);
    expect(text).not.toMatch(CURRENCY_SYMBOL);
    expect(text).not.toMatch(FABRICATED_NAME);
  });

  it.each(ROUTES)(
    "RL-009 $name leaves the polite announcement as its only text",
    (route) => {
      const main = renderRoute(route);

      const status = within(main).getByTestId("route-skeleton-status");
      expect(status.textContent?.trim()).not.toBe("");
      expect(main.textContent?.trim()).toBe(status.textContent?.trim());
    },
  );
});

describe("GH-32 skeletons expose a polite busy state (AC9)", () => {
  it.each(ROUTES)(
    "RL-010 $name hides every placeholder from assistive technology",
    (route) => {
      const shapes = Array.from(
        renderRoute(route).querySelectorAll(".skeleton"),
      );

      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(shape.getAttribute("aria-hidden")).toBe("true");
        expect(shape.textContent).toBe("");
      }
    },
  );

  it.each(ROUTES)(
    "RL-011 $name carries exactly one status region, and mounts it empty",
    (route) => {
      const main = renderRoute(route);

      // `memory-bank/systemPatterns.md` (Live regions): a region inserted with
      // its text already present is not announced, and the shell already mounts
      // two always-present regions, so a page's own must be single and scoped.
      expect(within(main).getAllByRole("status")).toHaveLength(1);
      expect(within(main).getByRole("status")).toBe(
        within(main).getByTestId("route-skeleton-status"),
      );

      // The mount output, not the settled DOM, is what decides whether a
      // screen reader ever hears this — so the label must be absent from it.
      const label = within(main).getByRole("status").textContent?.trim() ?? "";
      expect(label).not.toBe("");
      expect(renderToStaticMarkup(<route.Loading />)).not.toContain(label);
    },
  );

  it("RL-012 names each destination distinctly so a tab switch is legible", () => {
    const labels = ROUTES.map((route) => {
      const { unmount } = render(<route.Loading />);
      const label =
        screen.getByTestId("route-skeleton-status").textContent?.trim() ?? "";
      unmount();
      return label;
    });

    expect(labels.filter((label) => label.length > 0)).toHaveLength(
      ROUTES.length,
    );
    expect(new Set(labels).size).toBe(ROUTES.length);
  });
});

describe("GH-32 the root loader stays a cold-boot loader (AC14, AC15)", () => {
  it("RL-013 renders the cold-boot landmark under its own test id", () => {
    render(<RootLoading />);

    const main = screen.getByTestId("root-loading");
    expect(main.tagName).toBe("MAIN");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveAttribute("aria-busy", "true");
  });

  it("RL-014 never claims to be a route skeleton", () => {
    render(<RootLoading />);

    // It sits above `(app)/layout.tsx`, so if it ever appeared during a tab
    // switch the whole shell had been rebuilt. Coverage can only tell the two
    // apart if they never share a test id — see `e2e/route-loading.spec.ts`.
    expect(screen.queryByTestId("route-skeleton")).not.toBeInTheDocument();
  });

  it("RL-015 speaks the same placeholder language as the route skeletons", () => {
    render(<RootLoading />);

    const main = screen.getByTestId("root-loading");
    const shapes = Array.from(main.querySelectorAll(".skeleton"));
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.getAttribute("aria-hidden")).toBe("true");
    }

    const status = within(main).getByTestId("route-skeleton-status");
    expect(within(main).getAllByRole("status")).toHaveLength(1);
    expect(status.textContent?.trim()).not.toBe("");
    expect(main.textContent?.trim()).toBe(status.textContent?.trim());
  });

  it("RL-016 mounts its status region empty and shows no fabricated data", () => {
    render(<RootLoading />);

    const main = screen.getByTestId("root-loading");
    const label =
      within(main).getByTestId("route-skeleton-status").textContent?.trim() ??
      "";
    expect(label).not.toBe("");
    expect(renderToStaticMarkup(<RootLoading />)).not.toContain(label);

    const text = main.textContent ?? "";
    expect(text).not.toMatch(MONEY);
    expect(text).not.toMatch(FIGURE);
    expect(text).not.toMatch(CURRENCY_SYMBOL);
    expect(text).not.toMatch(FABRICATED_NAME);
  });
});
