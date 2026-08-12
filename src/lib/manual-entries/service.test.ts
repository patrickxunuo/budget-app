import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { manualEntriesToCsv, toManualEntryApiErrorResponse } from "./service";
import type { ManualEntry } from "./types";

const entry: ManualEntry = {
  id: "40000000-0000-4000-8000-000000000001",
  source: "manual",
  scope: "family",
  ownerProfileId: null,
  kind: "refund",
  amount: "12.50",
  currencyCode: "CAD",
  entryDate: "2026-08-12",
  description: 'Market, "refund"',
  categoryId: "30000000-0000-4000-8000-000000000001",
  categoryName: "Food, home",
  notes: "Line one\r\nLine two",
  createdBy: "10000000-0000-4000-8000-000000000001",
  lastEditedBy: "10000000-0000-4000-8000-000000000002",
  createdAt: "2026-08-12T16:00:00.000Z",
  updatedAt: "2026-08-12T17:00:00.000Z",
  deletedAt: null,
  deletedBy: null,
};

describe("manual-entry HTTP helpers", () => {
  it("escapes commas, quotes, and CRLF using stable RFC 4180 columns", () => {
    const csv = manualEntriesToCsv([entry]);
    expect(csv).toContain(
      "date,description,source,scope,kind,amount,currency,category,notes,created_by,last_edited_by\r\n",
    );
    expect(csv).toContain('"Market, ""refund"""');
    expect(csv).toContain('"Food, home"');
    expect(csv).toContain('"Line one\r\nLine two"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("uses the category ID fallback and empty cells without emitting undefined", () => {
    const csv = manualEntriesToCsv([
      { ...entry, categoryName: undefined, notes: null },
    ]);
    expect(csv).toContain(entry.categoryId);
    expect(csv).not.toContain("undefined");
  });

  it("maps malformed JSON to the structured 400 contract", async () => {
    const response = toManualEntryApiErrorResponse(
      new SyntaxError("Unexpected end of JSON input"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "validation_error",
        message: "Request body must be valid JSON.",
        fields: { request: "Request body must be valid JSON." },
      },
    });
  });
});
