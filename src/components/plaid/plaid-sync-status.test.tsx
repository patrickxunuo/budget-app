import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncStatus } from "@/lib/plaid/types";
import { PlaidSyncStatus } from "./plaid-sync-status";

const baseStatus: SyncStatus = {
  itemId: "50000000-0000-4000-8000-000000000001",
  institutionName: "Maple Test Bank",
  status: "succeeded",
  lastAttemptAt: "2026-08-11T20:00:00.000Z",
  lastSuccessAt: "2026-08-11T20:00:00.000Z",
  nextRetryAt: null,
  errorCode: null,
  needsLoginRepair: false,
  consentExpiresAt: null,
};

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GH-5 Plaid sync status", () => {
  it("FE-001 renders database freshness and repair state without requesting Plaid on mount", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PlaidSyncStatus
        items={[
          baseStatus,
          {
            ...baseStatus,
            itemId: "50000000-0000-4000-8000-000000000002",
            institutionName: "Cedar Credit Union",
            status: "failed",
            errorCode: "ITEM_LOGIN_REQUIRED",
            needsLoginRepair: true,
            consentExpiresAt: null,
          },
          {
            ...baseStatus,
            itemId: "50000000-0000-4000-8000-000000000003",
            institutionName: "Spruce Savings",
            consentExpiresAt: "2026-08-18T20:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getAllByTestId("plaid-sync-status")).toHaveLength(1);
    expect(screen.getByText("Maple Test Bank")).toBeVisible();
    expect(screen.getByText("Cedar Credit Union")).toBeVisible();
    expect(
      screen.getAllByText(/reconnect|repair|sign in again/i)[0],
    ).toBeVisible();
    expect(screen.getByText(/consent|permission/i)).toBeVisible();
    expect(screen.queryByText("ITEM_LOGIN_REQUIRED")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("FE-001 uses an explicit stable reference time and timezone for SSR/client freshness", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2035-01-01T00:00:00.000Z"));

    render(
      <PlaidSyncStatus
        items={[
          {
            ...baseStatus,
            lastSuccessAt: "2026-08-11T00:30:00.000Z",
          },
        ]}
        referenceTime="2026-08-13T00:30:00.000Z"
        timeZone="UTC"
      />,
    );

    expect(screen.getByText("Updated Aug 11")).toBeVisible();
    expect(screen.queryByText(/2035|Jan 1/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });
  it("FE-002 checks for updates once, exposes a busy button, and announces success", async () => {
    const pending = deferredResponse();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(<PlaidSyncStatus items={[baseStatus]} />);
    const button = screen.getByTestId("plaid-sync-check");
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/plaid/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
        body: JSON.stringify({ itemId: baseStatus.itemId }),
      }),
    );

    pending.resolve(
      new Response(
        JSON.stringify({
          itemId: baseStatus.itemId,
          status: "succeeded",
          added: 2,
          modified: 1,
          removed: 0,
          requestId: "request-safe",
          lastSuccessAt: "2026-08-11T21:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await waitFor(() => expect(button).not.toBeDisabled());
    const feedback = screen.getByTestId("plaid-sync-feedback");
    expect(feedback).toHaveAttribute("aria-live", "polite");
    expect(feedback).toHaveTextContent(/updated|current|complete|refreshed/i);
  });

  it("FE-003 shows actionable sanitized failure and repair guidance without provider internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "sync_failed",
            message: "We could not check for updates. Please try again.",
            providerError: "ACCESS_NOT_GRANTED: access-sandbox-secret",
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(
      <PlaidSyncStatus
        items={[
          baseStatus,
          {
            ...baseStatus,
            itemId: "50000000-0000-4000-8000-000000000002",
            institutionName: "Cedar Credit Union",
            needsLoginRepair: true,
            status: "failed",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getAllByTestId("plaid-sync-check")[0]!);

    const feedback = screen.getAllByTestId("plaid-sync-feedback")[0]!;
    await waitFor(() =>
      expect(feedback).toHaveTextContent(/try again|reconnect|could not/i),
    );
    expect(feedback).not.toHaveTextContent(
      /ACCESS_NOT_GRANTED|access-sandbox-secret|providerError/i,
    );
    expect(screen.getByText(/reconnect|repair|sign in again/i)).toBeVisible();
  });

  it("FE-004 remains keyboard-operable with reduced motion preferences", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemId: baseStatus.itemId,
          status: "idle",
          added: 0,
          modified: 0,
          removed: 0,
          requestId: "request-idle",
          lastSuccessAt: baseStatus.lastSuccessAt,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PlaidSyncStatus items={[baseStatus]} />);
    const button = screen.getByTestId("plaid-sync-check");
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
    fireEvent.click(button);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getAllByTestId("plaid-sync-status")[0]).toBeVisible();
  });
});

describe("GH-62 repaired sync status handoff", () => {
  it("changes Action needed to Connected and re-enables checks only after verified sync", async () => {
    render(
      <PlaidSyncStatus
        items={[
          {
            ...baseStatus,
            status: "failed",
            errorCode: "ITEM_LOGIN_REQUIRED",
            needsLoginRepair: true,
          },
        ]}
      />,
    );

    const button = screen.getByTestId("plaid-sync-check");
    expect(screen.getByText("Action needed")).toBeVisible();
    expect(button).toBeDisabled();

    fireEvent(
      window,
      new CustomEvent("plaid:sync-completed", {
        detail: {
          itemId: baseStatus.itemId,
          status: "succeeded",
          added: 2,
          modified: 0,
          removed: 0,
          requestId: "gh62-verified",
          lastSuccessAt: "2026-08-12T20:00:00.000Z",
        },
      }),
    );

    await waitFor(() => expect(screen.getByText("Connected")).toBeVisible());
    expect(screen.queryByText("Action needed")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/reconnect this institution/i),
    ).not.toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it("ignores failed or unrelated sync notifications and keeps repair action sticky", async () => {
    render(
      <PlaidSyncStatus
        items={[
          {
            ...baseStatus,
            status: "failed",
            errorCode: "ITEM_LOGIN_REQUIRED",
            needsLoginRepair: true,
          },
        ]}
      />,
    );

    fireEvent(
      window,
      new CustomEvent("plaid:sync-completed", {
        detail: {
          itemId: "50000000-0000-4000-8000-000000000099",
          status: "succeeded",
          lastSuccessAt: "2026-08-12T20:00:00.000Z",
        },
      }),
    );
    fireEvent(
      window,
      new CustomEvent("plaid:sync-completed", {
        detail: {
          itemId: baseStatus.itemId,
          status: "failed",
          lastSuccessAt: null,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("Action needed")).toBeVisible(),
    );
    expect(screen.getByTestId("plaid-sync-check")).toBeDisabled();
    expect(screen.getByText(/reconnect this institution/i)).toBeVisible();
  });
});
