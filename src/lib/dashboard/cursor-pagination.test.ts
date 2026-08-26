import { describe, expect, it } from "vitest";

import type { DashboardTransaction } from "./types";
import {
  compareDashboardTransactions,
  decodeDashboardCursor,
  encodeDashboardCursor,
} from "./cursor-pagination";

function row(
  id: string,
  date: string,
  source: DashboardTransaction["source"],
): DashboardTransaction {
  return {
    id,
    date,
    source,
    scope: "family",
    accountId: source === "plaid" ? "account" : null,
    accountName: source === "plaid" ? "Chequing" : null,
    merchantOrDescription: id,
    category: null,
    amountCents: -100,
    pending: false,
    kind: "spending",
    excluded: false,
  };
}

describe("GH-65 dashboard cursor pagination", () => {
  it("API-002 encodes the last row as an opaque cursor that round-trips the stable boundary", () => {
    const boundary = row("plaid-050", "2026-08-12", "plaid");
    const cursor = encodeDashboardCursor(boundary);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(boundary.id);
    expect(decodeDashboardCursor(cursor)).toEqual({
      version: 1,
      date: "2026-08-12",
      source: "plaid",
      id: "plaid-050",
    });
  });

  it("API-003 orders equal-date Plaid and Manual rows by source then id without duplicate boundaries", () => {
    const rows = [
      row("p-2", "2026-08-12", "plaid"),
      row("m-2", "2026-08-12", "manual"),
      row("p-1", "2026-08-12", "plaid"),
      row("m-1", "2026-08-12", "manual"),
      row("newer", "2026-08-13", "plaid"),
      row("older", "2026-08-11", "manual"),
    ].sort(compareDashboardTransactions);

    expect(rows.map(({ id }) => id)).toEqual([
      "newer",
      "m-1",
      "m-2",
      "p-1",
      "p-2",
      "older",
    ]);

    const firstPage = rows.slice(0, 3);
    const boundary = decodeDashboardCursor(
      encodeDashboardCursor(firstPage.at(-1)!),
    );
    const secondPage = rows.filter(
      (candidate) => compareDashboardTransactions(candidate, boundary) > 0,
    );
    expect([...firstPage, ...secondPage].map(({ id }) => id)).toEqual(
      rows.map(({ id }) => id),
    );
    expect(
      new Set([...firstPage, ...secondPage].map(({ id }) => id)).size,
    ).toBe(rows.length);
  });

  it.each([
    ["not-base64url", "malformed base64url"],
    [Buffer.from("{}", "utf8").toString("base64url"), "missing fields"],
    [
      Buffer.from(
        JSON.stringify({
          version: 2,
          date: "2026-08-12",
          source: "plaid",
          id: "row",
        }),
        "utf8",
      ).toString("base64url"),
      "unsupported version",
    ],
    [
      Buffer.from(
        JSON.stringify({
          version: 1,
          date: "2026-02-30",
          source: "plaid",
          id: "row",
        }),
        "utf8",
      ).toString("base64url"),
      "invalid calendar date",
    ],
    [
      Buffer.from(
        JSON.stringify({
          version: 1,
          date: "2026-08-12",
          source: "cash",
          id: "row",
        }),
        "utf8",
      ).toString("base64url"),
      "unsupported source",
    ],
  ])("API-005 rejects %s cursors", (cursor) => {
    expect(() => decodeDashboardCursor(cursor)).toThrow();
  });

  it("API-007 continues lexicographically when the boundary row was removed", () => {
    const complete = [
      row("a", "2026-08-13", "manual"),
      row("b", "2026-08-12", "manual"),
      row("c", "2026-08-12", "plaid"),
      row("d", "2026-08-11", "manual"),
    ].sort(compareDashboardTransactions);
    const cursor = encodeDashboardCursor(complete[1]!);
    const boundary = decodeDashboardCursor(cursor);

    const afterRemoval = complete.filter(({ id }) => id !== "b");
    const continuation = afterRemoval.filter(
      (candidate) => compareDashboardTransactions(candidate, boundary) > 0,
    );

    expect(continuation.map(({ id }) => id)).toEqual(["c", "d"]);
    expect(continuation).not.toContainEqual(
      expect.objectContaining({ id: "a" }),
    );
  });
});
