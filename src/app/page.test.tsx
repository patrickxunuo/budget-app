import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("home page", () => {
  it("states the product boundary and links to the application shell", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /shared money\.\s*clear boundaries\./i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View application shell" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
