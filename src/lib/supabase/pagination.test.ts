import { describe, expect, it, vi } from "vitest";

import { collectAllPages } from "./pagination";

describe("collectAllPages", () => {
  it("collects rows beyond Supabase's configured 1,000-row response cap", async () => {
    const source = Array.from({ length: 1001 }, (_, index) => index);
    const fetchPage = vi.fn(async (from: number, to: number) =>
      source.slice(from, to + 1),
    );

    await expect(collectAllPages(fetchPage)).resolves.toEqual(source);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 999);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("rejects invalid page sizes and oversized responses", async () => {
    await expect(collectAllPages(async () => [], 0)).rejects.toThrow(
      /pageSize/,
    );
    await expect(collectAllPages(async () => [1, 2], 1)).rejects.toThrow(
      /more than/,
    );
  });
});
