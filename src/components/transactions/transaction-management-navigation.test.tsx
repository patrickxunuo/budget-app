import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  TransactionManagementBackLink,
  TransactionManagementMenu,
} from "./transaction-management-navigation";

describe("GH-64 transaction management navigation", () => {
  it.each(["family", "personal"] as const)(
    "FE-002 Manage links preserve the %s scope and exact canonical return target",
    (scope) => {
      const returnTo = `/transactions?scope=${scope}&period=week&reference=2026-08-24&search=coffee`;
      render(<TransactionManagementMenu scope={scope} returnTo={returnTo} />);

      const menu = screen.getByTestId("transactions-manage-menu");
      expect(menu).toBeInTheDocument();
      const trigger = screen.getByText(/^Manage/);
      fireEvent.click(trigger);

      for (const [testId, route] of [
        ["transactions-manage-manual", "/transactions/manual"],
        ["transactions-manage-plaid", "/transactions/plaid"],
      ] as const) {
        const link = screen.getByTestId(testId);
        const href = new URL(link.getAttribute("href")!, "http://localhost");
        expect(href.pathname).toBe(route);
        expect(href.searchParams.get("scope")).toBe(scope);
        expect(href.searchParams.get("returnTo")).toBe(returnTo);
      }
    },
  );

  it("FE-003 renders an accessible Back to Transactions link with the resolved href", () => {
    const href =
      "/transactions?scope=personal&period=custom&from=2026-08-01&to=2026-08-24";
    render(<TransactionManagementBackLink href={href} />);

    const link = screen.getByTestId("back-to-transactions");
    expect(link).toHaveAccessibleName("Back to Transactions");
    expect(link).toHaveAttribute("href", href);
  });
});
