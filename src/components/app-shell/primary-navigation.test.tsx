import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BottomNavigation,
  NavigationRail,
  PRIMARY_NAVIGATION,
  SECONDARY_NAVIGATION,
} from "./primary-navigation";

// `vi.hoisted` and `vi.mock` are both lifted above the imports above, so the
// component module sees the mocked `usePathname` when it is first evaluated.
const { usePathname } = vi.hoisted(() => ({
  usePathname: vi.fn<() => string | null>(),
}));

vi.mock("next/navigation", () => ({ usePathname }));

const PRIMARY = [
  { label: "Overview", href: "/dashboard" },
  { label: "Accounts", href: "/accounts" },
  { label: "Transactions", href: "/transactions" },
  { label: "Budgets", href: "/budgets" },
  { label: "Categories", href: "/categories" },
];

const SECONDARY = [{ label: "Household", href: "/settings/members" }];

function currentLinks(scope: HTMLElement) {
  return within(scope)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page");
}

afterEach(() => {
  usePathname.mockReset();
});

describe("GH-13 navigation destinations (AC3)", () => {
  it("NV-001 exposes exactly the five thumb-reach destinations", () => {
    expect(
      PRIMARY_NAVIGATION.map(({ label, href }) => ({ label, href })),
    ).toEqual(PRIMARY);
  });

  it("NV-002 keeps household administration out of the bottom bar", () => {
    expect(
      SECONDARY_NAVIGATION.map(({ label, href }) => ({ label, href })),
    ).toEqual(SECONDARY);
  });
});

describe("GH-13 bottom navigation below lg (AC3)", () => {
  it("NV-003 renders a labelled landmark with exactly the five primary links", () => {
    usePathname.mockReturnValue("/dashboard");

    render(<BottomNavigation />);

    const nav = screen.getByRole("navigation");
    expect(nav).toHaveAccessibleName();
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      PRIMARY.map((item) => item.href),
    );
    expect(
      within(nav).queryByRole("link", { name: /household/i }),
    ).not.toBeInTheDocument();
  });

  it("NV-004 marks exactly the current route with aria-current", () => {
    usePathname.mockReturnValue("/budgets");

    render(<BottomNavigation />);

    const nav = screen.getByRole("navigation");
    const active = currentLinks(nav);
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/budgets");
    expect(active[0]).toHaveTextContent(/budgets/i);
  });

  it("NV-005 keeps a nested route inside its section", () => {
    usePathname.mockReturnValue("/transactions/123");

    render(<BottomNavigation />);

    const active = currentLinks(screen.getByRole("navigation"));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/transactions");
  });

  it("NV-006 marks nothing when the route is outside the primary set", () => {
    usePathname.mockReturnValue("/sign-in");

    render(<BottomNavigation />);

    expect(currentLinks(screen.getByRole("navigation"))).toHaveLength(0);
    expect(
      screen.queryByTestId("nav-active-indicator"),
    ).not.toBeInTheDocument();
  });

  it("NV-007 does not let a prefix collision activate a sibling route", () => {
    usePathname.mockReturnValue("/accountsomething");

    render(<BottomNavigation />);

    expect(currentLinks(screen.getByRole("navigation"))).toHaveLength(0);
  });
});

describe("GH-13 desktop navigation rail (AC3)", () => {
  it("NV-008 renders all six destinations in a labelled landmark", () => {
    usePathname.mockReturnValue("/dashboard");

    render(<NavigationRail />);

    const nav = screen.getByRole("navigation");
    expect(nav).toHaveAccessibleName();
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(6);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      ...PRIMARY.map((item) => item.href),
      ...SECONDARY.map((item) => item.href),
    ]);
  });

  it("NV-009 applies the same aria-current rule, including nested settings routes", () => {
    usePathname.mockReturnValue("/settings/members");

    render(<NavigationRail />);

    const active = currentLinks(screen.getByRole("navigation"));
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAttribute("href", "/settings/members");
  });
});

describe("GH-13 the active route is not signalled by colour alone (AC3, AC5)", () => {
  it.each([
    ["BottomNavigation", BottomNavigation],
    ["NavigationRail", NavigationRail],
  ])("NV-010 %s pairs aria-current with a shape indicator", (_name, Nav) => {
    usePathname.mockReturnValue("/categories");

    render(<Nav />);

    const nav = screen.getByRole("navigation");
    const active = currentLinks(nav);
    expect(active).toHaveLength(1);

    const indicators = screen.getAllByTestId("nav-active-indicator");
    expect(indicators).toHaveLength(1);
    expect(active[0]?.contains(indicators[0] as Node)).toBe(true);
  });
});
