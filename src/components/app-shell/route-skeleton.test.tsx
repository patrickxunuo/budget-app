import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RouteSkeleton, SkeletonShape } from "./route-skeleton";
import { SkeletonAnnouncement } from "./skeleton-announcement";

// jsdom applies no stylesheet, so the reduced-motion promise can only be
// checked by reading the rule — the same approach `src/lib/theme/contrast.test.ts`
// takes for the palette, and for the same reason: eye review does not scale.
const GLOBALS_CSS = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

/** The declarations of the brace-matched block that starts at `index`. */
function blockAt(css: string, index: number): string {
  const open = css.indexOf("{", index);
  let depth = 0;
  for (let cursor = open; cursor < css.length; cursor += 1) {
    if (css[cursor] === "{") depth += 1;
    else if (css[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, cursor);
    }
  }
  return "";
}

/** Every `@media (prefers-reduced-motion: reduce)` body in the stylesheet. */
function reducedMotionBlocks(css: string): string[] {
  const blocks: string[] = [];
  const marker = /@media\s*\(prefers-reduced-motion:\s*reduce\)/g;
  let match = marker.exec(css);
  while (match !== null) {
    blocks.push(blockAt(css, match.index));
    match = marker.exec(css);
  }
  return blocks;
}

// Deliberately not one of the six real routes' class strings: this file proves
// the primitive passes whatever it is handed through verbatim, and
// `src/app/(app)/route-loading.test.tsx` proves the six pass the right values.
const MAIN_CLASS_NAME = "px-5 py-9 sm:px-8 lg:px-12";
const CONTAINER_CLASS_NAME = "mx-auto max-w-6xl";
const LABEL = "Loading the test route";

function renderSkeleton() {
  render(
    <RouteSkeleton
      label={LABEL}
      mainClassName={MAIN_CLASS_NAME}
      containerClassName={CONTAINER_CLASS_NAME}
    >
      <SkeletonShape className="h-10 w-40" />
      <SkeletonShape className="h-4 w-24" />
    </RouteSkeleton>,
  );
  return screen.getByTestId("route-skeleton");
}

describe("GH-32 the skeleton reproduces the route's landmark (AC6)", () => {
  it("RS-001 keeps the skip-link target addressable and focusable while loading", () => {
    const main = renderSkeleton();

    // `memory-bank/systemPatterns.md` (Skip links): the target is each route's
    // own <main>, so a fallback that omits it drops the skip link into a void
    // for exactly as long as the route takes to arrive.
    expect(main.tagName).toBe("MAIN");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("RS-002 passes the route's own <main> classes through verbatim", () => {
    const main = renderSkeleton();

    // Exact equality, not a class-membership check: any padding or max-width
    // the fallback adds or drops is a layout shift when the real page swaps in.
    expect(main.getAttribute("class")).toBe(MAIN_CLASS_NAME);
  });

  it("RS-003 wraps the placeholders in the route's own container", () => {
    const main = renderSkeleton();

    const container = main.querySelector("div");
    expect(container?.getAttribute("class")).toBe(CONTAINER_CLASS_NAME);
    expect(container?.querySelectorAll(".skeleton")).toHaveLength(2);
  });
});

describe("GH-32 placeholder shapes are shapes, never content (AC7, AC9)", () => {
  it("RS-004 renders an aria-hidden span carrying the shared skeleton fill", () => {
    render(<SkeletonShape className="h-10 w-40" />);

    const shape = document.querySelector("span.skeleton");
    expect(shape).not.toBeNull();
    expect(shape).toHaveAttribute("aria-hidden", "true");
    // `block` comes from the contract rather than the caller, so a shape can
    // never collapse to an inline box and lose its height.
    expect(shape?.classList.contains("block")).toBe(true);
    expect(shape?.classList.contains("h-10")).toBe(true);
    expect(shape?.classList.contains("w-40")).toBe(true);
  });

  it("RS-005 gives a shape no text of its own", () => {
    render(<SkeletonShape className="h-10 w-40" />);

    expect(document.querySelector("span.skeleton")?.textContent).toBe("");
  });

  it("RS-006 leaves the polite announcement as the skeleton's only text", () => {
    const main = renderSkeleton();

    // If this ever fails, something inside the fallback is being read out as
    // page content — which is the fabricated-data failure AC7 exists to stop.
    expect(main.textContent?.trim()).toBe(LABEL);
  });
});

describe("GH-32 the busy state is announced, once and politely (AC9)", () => {
  it("RS-007 marks the landmark busy", () => {
    expect(renderSkeleton()).toHaveAttribute("aria-busy", "true");
  });

  it("RS-008 carries exactly one visually hidden status region inside <main>", () => {
    const main = renderSkeleton();

    const regions = within(main).getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0]).toBe(screen.getByTestId("route-skeleton-status"));
    expect(regions[0]?.tagName).toBe("P");
    expect(regions[0]?.classList.contains("sr-only")).toBe(true);
  });

  it("RS-009 mounts the status region empty", () => {
    // `memory-bank/systemPatterns.md` (Live regions): a region inserted with
    // its text already present is not announced, so the mount output — not the
    // settled DOM — is what decides whether a screen reader ever hears this.
    const markup = renderToStaticMarkup(
      <SkeletonAnnouncement message={LABEL} />,
    );

    expect(markup).toContain('data-testid="route-skeleton-status"');
    expect(markup).not.toContain(LABEL);
    expect(markup).toMatch(/<p[^>]*>\s*<\/p>/);
  });

  it("RS-010 mounts the whole skeleton without its message, then fills it in an effect", () => {
    expect(
      renderToStaticMarkup(
        <RouteSkeleton
          label={LABEL}
          mainClassName={MAIN_CLASS_NAME}
          containerClassName={CONTAINER_CLASS_NAME}
        >
          <SkeletonShape className="h-10 w-40" />
        </RouteSkeleton>,
      ),
    ).not.toContain(LABEL);

    renderSkeleton();

    expect(screen.getByTestId("route-skeleton-status")).toHaveTextContent(
      LABEL,
    );
  });

  it("RS-011 announces the label it was given rather than a fixed string", () => {
    render(
      <RouteSkeleton
        label="Loading a different route"
        mainClassName={MAIN_CLASS_NAME}
        containerClassName={CONTAINER_CLASS_NAME}
      >
        <SkeletonShape className="h-4 w-24" />
      </RouteSkeleton>,
    );

    expect(screen.getByTestId("route-skeleton-status")).toHaveTextContent(
      "Loading a different route",
    );
  });
});

describe("GH-32 reduced motion yields a static placeholder (AC8)", () => {
  it("RS-012 animates the placeholder with a sweep by default", () => {
    expect(GLOBALS_CSS).toMatch(
      /\.skeleton::after\s*\{[^}]*animation-name:\s*skeleton-sweep/,
    );
    expect(GLOBALS_CSS).toMatch(/\.skeleton::after\s*\{[^}]*content:\s*""/);
  });

  it("RS-013 removes the sweep under reduced motion rather than freezing it", () => {
    // The stylesheet's global reduced-motion block only clamps
    // `animation-duration` to 0.01ms. That parks a translating gradient on its
    // final frame — a lopsided smear, not a placeholder — so the sweep's own
    // pseudo-element has to be dropped outright.
    const removed = reducedMotionBlocks(GLOBALS_CSS).some((block) =>
      /\.skeleton::after\s*\{[^}]*content:\s*none/.test(block),
    );

    expect(reducedMotionBlocks(GLOBALS_CSS).length).toBeGreaterThan(0);
    expect(removed).toBe(true);
  });
});
