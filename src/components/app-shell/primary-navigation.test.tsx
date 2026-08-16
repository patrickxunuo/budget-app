import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BottomNavigation,
  NavigationRail,
  PRIMARY_NAVIGATION,
  SECONDARY_NAVIGATION,
} from "./primary-navigation";

// `vi.hoisted` and `vi.mock` are both lifted above the imports above, so the
// component module sees the mocked `usePathname` when it is first evaluated.
const { usePathname, useLinkStatus } = vi.hoisted(() => ({
  usePathname: vi.fn<() => string | null>(),
  useLinkStatus: vi.fn<() => { pending: boolean }>(),
}));

vi.mock("next/navigation", () => ({ usePathname }));

// GH-32's pending affordance reads `useLinkStatus`, which ships from
// `next/link` rather than `next/navigation`. Only that export is replaced:
// `importActual` keeps the default `Link` real, so every case above still
// renders real anchors and the GH-13 assertions are untouched.
vi.mock("next/link", async () => ({
  ...(await vi.importActual<typeof import("next/link")>("next/link")),
  useLinkStatus,
}));

const PRIMARY = [
  { label: "Overview", href: "/dashboard" },
  { label: "Accounts", href: "/accounts" },
  { label: "Transactions", href: "/transactions" },
  { label: "Budgets", href: "/budgets" },
  { label: "Categories", href: "/categories" },
];

const SECONDARY = [{ label: "Family members", href: "/settings/members" }];

function currentLinks(scope: HTMLElement) {
  return within(scope)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page");
}

// The real hook is per-`Link` context; a module mock is global, so every
// indicator in a render shares one state. That is enough to prove presence,
// placement, and distinctness — which link is pending is a browser question.
beforeEach(() => {
  useLinkStatus.mockReturnValue({ pending: false });
});

afterEach(() => {
  usePathname.mockReset();
  useLinkStatus.mockReset();
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

const NAVIGATIONS = [
  ["BottomNavigation", BottomNavigation, PRIMARY.length] as const,
  [
    "NavigationRail",
    NavigationRail,
    PRIMARY.length + SECONDARY.length,
  ] as const,
];

describe("GH-32 every destination carries its own pending affordance (AC10)", () => {
  it.each(NAVIGATIONS)(
    "NV-011 %s gives each link exactly one pending indicator",
    (_name, Nav, expected) => {
      usePathname.mockReturnValue("/dashboard");

      render(<Nav />);

      const nav = screen.getByRole("navigation");
      const links = within(nav).getAllByRole("link");
      expect(links).toHaveLength(expected);
      expect(within(nav).getAllByTestId("nav-pending-indicator")).toHaveLength(
        expected,
      );
      for (const link of links) {
        expect(
          within(link).getAllByTestId("nav-pending-indicator"),
        ).toHaveLength(1);
      }
    },
  );

  it.each(NAVIGATIONS)(
    "NV-012 %s keeps the indicator mounted whether or not the link is pending",
    (_name, Nav, expected) => {
      usePathname.mockReturnValue("/dashboard");
      useLinkStatus.mockReturnValue({ pending: true });

      render(<Nav />);

      // Fixed space, not a conditional mount: an indicator that appears on
      // click would reflow the bar under the thumb that just tapped it.
      const indicators = screen.getAllByTestId("nav-pending-indicator");
      expect(indicators).toHaveLength(expected);
      for (const indicator of indicators) {
        expect(indicator).toHaveAttribute("data-pending", "true");
      }
    },
  );
});

describe("GH-32 pending is not the active state wearing a different colour (AC12)", () => {
  it.each(NAVIGATIONS)(
    "NV-013 %s draws the pending affordance as a separate node from the active bar",
    (_name, Nav) => {
      usePathname.mockReturnValue("/categories");
      useLinkStatus.mockReturnValue({ pending: true });

      render(<Nav />);

      const active = currentLinks(screen.getByRole("navigation"))[0];
      expect(active).toBeDefined();
      const activeIndicator = within(active!).getByTestId(
        "nav-active-indicator",
      );
      const pendingIndicator = within(active!).getByTestId(
        "nav-pending-indicator",
      );

      // Both live on the active link at once, so neither may be the other:
      // "you are here" and "you are going there" are different facts.
      expect(pendingIndicator).not.toBe(activeIndicator);
      expect(activeIndicator.contains(pendingIndicator)).toBe(false);
      expect(pendingIndicator.contains(activeIndicator)).toBe(false);
    },
  );

  it.each(NAVIGATIONS)(
    "NV-014 %s leaves the links' accessible names unchanged by the indicator",
    (_name, Nav) => {
      usePathname.mockReturnValue("/categories");
      useLinkStatus.mockReturnValue({ pending: true });

      render(<Nav />);

      for (const indicator of screen.getAllByTestId("nav-pending-indicator")) {
        expect(indicator).toHaveAttribute("aria-hidden", "true");
        expect(indicator.textContent).toBe("");
      }
      // NV-003/NV-008 above assert the link hrefs and labels; this proves the
      // affordance did not smuggle a word into any of them.
      for (const link of within(screen.getByRole("navigation")).getAllByRole(
        "link",
      )) {
        expect(link).toHaveAccessibleName();
        expect(link.textContent).not.toMatch(/pending|loading/i);
      }
    },
  );
});

describe("GH-51 route-name coverage remains aligned with authenticated navigation", () => {
  it.each([
    [BottomNavigation, PRIMARY.length],
    [NavigationRail, PRIMARY.length + SECONDARY.length],
  ] as const)(
    "FE-001 keeps every rendered authenticated destination named and touch-sized",
    (Navigation, expectedLinks) => {
      usePathname.mockReturnValue("/dashboard");
      render(<Navigation />);

      const links = within(screen.getByRole("navigation")).getAllByRole("link");
      expect(links).toHaveLength(expectedLinks);
      for (const link of links) {
        expect(link).toHaveAccessibleName();
        expect(link.className).toMatch(/(?:min-h-(?:11|14)|min-w-11|h-11)/);
      }
    },
  );

  it("FE-001 keeps Family members reachable through the owning settings route", () => {
    expect(SECONDARY_NAVIGATION).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "/settings/members" }),
      ]),
    );
  });
});
