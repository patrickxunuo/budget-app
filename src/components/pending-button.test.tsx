import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PendingButton } from "./pending-button";

const pendingCss = readFileSync(
  join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

describe("GH-33 shared pending button", () => {
  it("FE-002 preserves caller props and reserves one footprint for both labels", () => {
    const { rerender } = render(
      <PendingButton
        pending={false}
        pendingLabel="Saving…"
        type="submit"
        className="caller-button"
        data-testid="pending-save"
      >
        Save changes
      </PendingButton>,
    );

    const idleButton = screen.getByTestId("pending-save");
    const idleLabel = within(idleButton).getByText("Save changes");
    const pendingLabel = within(idleButton).getByText("Saving…");
    expect(idleButton).toHaveAttribute("type", "submit");
    expect(idleButton).toHaveClass("caller-button");
    expect(idleButton).toHaveAttribute("data-pending", "false");
    expect(idleButton).not.toHaveAttribute("aria-busy");
    expect(idleButton).toBeEnabled();
    expect(idleButton).toHaveAccessibleName("Save changes");
    expect(idleLabel.parentElement).toBe(pendingLabel.parentElement);
    expect(idleLabel.parentElement).toHaveClass("pending-button-content");
    expect(pendingCss).toMatch(
      /\.pending-button-content\s*\{[\s\S]*?display:\s*inline-grid;/,
    );
    expect(pendingCss).toMatch(
      /\.pending-button-label\s*\{[\s\S]*?grid-area:\s*1\s*\/\s*1;/,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    rerender(
      <PendingButton
        pending
        pendingLabel="Saving…"
        type="submit"
        className="caller-button"
        data-testid="pending-save"
      >
        Save changes
      </PendingButton>,
    );

    const busyButton = screen.getByTestId("pending-save");
    expect(within(busyButton).getByText("Save changes")).toBeInTheDocument();
    expect(within(busyButton).getByText("Saving…")).toBeInTheDocument();
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute("aria-busy", "true");
    expect(busyButton).toHaveAttribute("data-pending", "true");
    expect(busyButton).toHaveAccessibleName("Saving…");
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
  });

  it("FE-002 preserves a caller-disabled condition while idle", () => {
    render(
      <PendingButton pending={false} pendingLabel="Saving…" disabled>
        Save changes
      </PendingButton>,
    );

    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("FE-008 conveys pending with text and static-capable, aria-hidden animated dots", () => {
    render(
      <PendingButton pending pendingLabel="Reconciling…">
        Reconcile fresh account set
      </PendingButton>,
    );

    const button = screen.getByRole("button", { name: "Reconciling…" });
    expect(button).toHaveTextContent("Reconciling…");
    const decorativeMotion = button.querySelector(".pending-button-dots");
    expect(decorativeMotion).toHaveAttribute("aria-hidden", "true");
    expect(decorativeMotion?.querySelectorAll("i")).toHaveLength(3);
    expect(pendingCss).toMatch(
      /\.pending-button-dots i\s*\{[\s\S]*?animation:\s*pending-button-dot/,
    );
    expect(pendingCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.pending-button-dots i\s*\{[^}]*animation:\s*none;/,
    );
  });
});
