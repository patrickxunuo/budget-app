import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RouteHeader } from "./route-header";

const { usePathname } = vi.hoisted(() => ({
  usePathname: vi.fn<() => string | null>(),
}));

vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("@/components/theme/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));
vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

afterEach(() => {
  usePathname.mockReset();
});

const ROUTES = [
  ["/dashboard", "Overview"],
  ["/transactions", "Transactions"],
  ["/budgets", "Budgets"],
  ["/accounts", "Accounts"],
  ["/categories", "Categories"],
  ["/settings/members", "Family members"],
] as const;

describe("GH-51 compact authenticated route header", () => {
  it.each(ROUTES)(
    "FE-001 names %s as %s with the only page-level heading",
    (pathname, label) => {
      usePathname.mockReturnValue(pathname);

      render(<RouteHeader />);

      const header = screen.getByTestId("workspace-header");
      expect(header.parentElement).toHaveClass("safe-top");
      const heading = within(header).getByTestId("route-heading");
      expect(heading.tagName).toBe("H1");
      expect(heading).toHaveTextContent(label);
      expect(screen.getAllByRole("heading", { level: 1 })).toEqual([heading]);
      expect(
        within(header).getByRole("button", { name: "Theme" }),
      ).toBeVisible();
    },
  );

  it.each([
    ["/dashboard/activity", "Overview"],
    ["/transactions/transaction-1", "Transactions"],
    ["/budgets/2026-08", "Budgets"],
    ["/accounts/item-1", "Accounts"],
    ["/categories/category-1", "Categories"],
    ["/settings/members/invitations", "Family members"],
  ] as const)("FE-001 resolves nested pathname %s to %s", (pathname, label) => {
    usePathname.mockReturnValue(pathname);

    render(<RouteHeader />);

    expect(screen.getByTestId("route-heading")).toHaveTextContent(label);
  });

  it("FE-001 preserves the theme, install, family-member, and sign-out actions in a labelled account menu", () => {
    usePathname.mockReturnValue("/dashboard");

    render(<RouteHeader />);

    const header = screen.getByTestId("workspace-header");
    const accountButton = within(header).getByRole("button", {
      name: /account/i,
    });
    expect(accountButton).toHaveAccessibleName();
    fireEvent.click(accountButton);

    expect(
      within(header).getByRole("link", { name: /install/i }),
    ).toHaveAttribute("href", "/install");
    expect(
      within(header).getByRole("link", { name: /family|member|household/i }),
    ).toHaveAttribute("href", "/settings/members");
    expect(
      within(header).getByRole("button", { name: /sign out/i }),
    ).toBeVisible();

    expect(accountButton.className).toMatch(/(?:min-h-11|size-11|h-11)/);
  });
});
