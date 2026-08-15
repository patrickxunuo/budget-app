import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationPendingIndicator } from "./navigation-pending-indicator";

// The component states *that* it is pending; the stylesheet decides whether a
// member ever sees it. jsdom applies no stylesheet, so the rule is read the way
// `src/lib/theme/contrast.test.ts` reads the palette.
const GLOBALS_CSS = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function ruleBody(selector: RegExp): string {
  return (
    new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`).exec(GLOBALS_CSS)?.[1] ??
    ""
  );
}

// `vi.hoisted` and `vi.mock` are both lifted above the imports above, so the
// component module sees the mocked `useLinkStatus` when it is first evaluated.
const { useLinkStatus } = vi.hoisted(() => ({
  useLinkStatus: vi.fn<() => { pending: boolean }>(),
}));

// Only the hook is replaced. `useLinkStatus` ships from `next/link`, not
// `next/navigation`, and the module's default `Link` export has to survive the
// mock or every anchor rendered under it disappears — hence `importActual`.
vi.mock("next/link", async () => ({
  ...(await vi.importActual<typeof import("next/link")>("next/link")),
  useLinkStatus,
}));

function renderIndicator(pending: boolean, className?: string) {
  useLinkStatus.mockReturnValue({ pending });
  const { unmount } = render(
    <NavigationPendingIndicator className={className} />,
  );
  return { indicator: screen.getByTestId("nav-pending-indicator"), unmount };
}

beforeEach(() => {
  useLinkStatus.mockReturnValue({ pending: false });
});

afterEach(() => {
  useLinkStatus.mockReset();
});

describe("GH-32 the pending affordance occupies fixed space (AC10, AC11)", () => {
  it("NP-001 renders while the link is idle", () => {
    const { indicator } = renderIndicator(false);

    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute("data-pending", "false");
  });

  it("NP-002 renders while the link is pending", () => {
    const { indicator } = renderIndicator(true);

    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute("data-pending", "true");
  });

  it("NP-003 differs between the two states by the state attribute alone", () => {
    // The Next docs call inline indicators out as a layout-shift hazard and
    // prescribe a fixed-size, always-rendered hint. Comparing the two markups
    // is the direct form of that promise: identical boxes, one attribute apart,
    // so nothing around the indicator can move when a navigation starts.
    const idle = renderIndicator(false, "ml-2");
    const idleMarkup = idle.indicator.outerHTML;
    idle.unmount();

    const busy = renderIndicator(true, "ml-2");
    const busyMarkup = busy.indicator.outerHTML;

    expect(busyMarkup).not.toBe(idleMarkup);
    expect(
      busyMarkup.replace('data-pending="true"', 'data-pending="false"'),
    ).toBe(idleMarkup);
  });

  it("NP-004 keeps the caller's classes beside the shared nav-pending box", () => {
    const { indicator } = renderIndicator(false, "ml-2 shrink-0");

    expect(indicator.classList.contains("nav-pending")).toBe(true);
    expect(indicator.classList.contains("ml-2")).toBe(true);
    expect(indicator.classList.contains("shrink-0")).toBe(true);
  });
});

describe("GH-32 the affordance is a shape, not a colour or a message (AC12)", () => {
  it.each([
    ["idle", false],
    ["pending", true],
  ])("NP-005 renders three dots while %s", (_state, pending) => {
    const { indicator } = renderIndicator(pending);

    // Three dots rather than a tint: the active `aria-current` indicator is a
    // solid bar, so the two states stay distinguishable without colour.
    expect(indicator.querySelectorAll(".nav-pending-dot")).toHaveLength(3);
  });

  it.each([
    ["idle", false],
    ["pending", true],
  ])(
    "NP-006 stays out of the accessibility tree while %s",
    (_state, pending) => {
      const { indicator } = renderIndicator(pending);

      // The nav links' accessible names are asserted in
      // `primary-navigation.test.tsx`; an announced indicator would change every
      // one of them, and a pending state is not something to read out per link.
      expect(indicator).toHaveAttribute("aria-hidden", "true");
      expect(indicator.textContent).toBe("");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );
});

describe("GH-32 an effectively instant transition shows no flash (AC11, AC13)", () => {
  it("NP-007 reserves the indicator's box while hiding it in the idle state", () => {
    const idle = ruleBody(/\.nav-pending/);

    expect(idle).toMatch(/opacity:\s*0\b/);
    // A reserved box, not `display: none`: the size has to exist before the
    // state changes or the surrounding item resizes when it does.
    expect(idle).toMatch(/height:\s*[\d.]/);
    expect(idle).toMatch(/width:\s*[\d.]/);
    expect(idle).not.toMatch(/display:\s*none/);
  });

  it("NP-008 delays the fade so a prefetched destination never flashes it", () => {
    const pending = ruleBody(/\.nav-pending\[data-pending="true"\]/);

    expect(pending).toMatch(/animation-delay:\s*100ms/);
    expect(pending).toMatch(/animation-name:/);
  });
});
