import { describe, expect, it } from "vitest";

import {
  dashboardExportQuerySchema,
  dashboardQuerySchema,
} from "@/lib/dashboard/validation";

import {
  describeActiveFilters,
  parseExplorerFilters,
  toExplorerSearchParams,
  toReadModelQuery,
  type ExplorerFilters,
} from "./explorer-filters";

/**
 * GH-30 UNIT-001..UNIT-008.
 *
 * The load-bearing pair is UNIT-005/006: `toReadModelQuery` output is fed
 * straight into the real `/api/dashboard` and `/api/transactions/export`
 * schemas. Both are `.strict()`, so an extra, misnamed, or malformed key is a
 * parse failure here rather than a 400 in the browser.
 *
 * Two points the contract leaves implicit, and how these tests treat them:
 *
 * - `from`/`to` when `period !== "custom"`. Whether a surviving bound is kept
 *   (so the custom form remembers what the reader typed) or cleared is the
 *   implementation's call. What is asserted is what the contract actually
 *   requires: a non-calendar bound is never retained, `toReadModelQuery` never
 *   emits either key outside a custom period, and whichever choice is made
 *   still round-trips through the URL under rule 5.
 * - `reference` is always written by `toExplorerSearchParams`. "Defaults
 *   omitted" cannot cover it: its default is the caller's `today`, and the
 *   frozen signature takes no `today`, so omitting it would silently re-anchor
 *   a shared link on whatever day it is opened.
 */

const TODAY = "2026-08-14";
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";

/** Every key either server schema is willing to accept from this module. */
const ALLOWED_QUERY_KEYS = [
  "scope",
  "period",
  "reference",
  "from",
  "to",
  "accountId",
  "categoryId",
  "status",
  "inclusion",
  "search",
];

function defaults(reference = TODAY): ExplorerFilters {
  return {
    scope: "family",
    period: "month",
    reference,
    from: "",
    to: "",
    search: "",
    accountId: "",
    categoryId: "",
    status: "all",
    inclusion: "default",
  };
}

/**
 * Asserts the filters can never produce a request the strict server schemas
 * reject. `error.issues` is asserted before `success` so a failure names the
 * offending key instead of printing `expected false to be true`.
 */
function expectServerSafe(filters: ExplorerFilters) {
  const query = toReadModelQuery(filters);
  for (const key of Object.keys(query)) {
    expect(ALLOWED_QUERY_KEYS).toContain(key);
  }
  const read = dashboardQuerySchema.safeParse({ ...query, limit: "50" });
  expect(read.error?.issues ?? []).toEqual([]);
  expect(read.success).toBe(true);
  const exported = dashboardExportQuerySchema.safeParse(query);
  expect(exported.error?.issues ?? []).toEqual([]);
  expect(exported.success).toBe(true);
}

describe("GH-30 UNIT-001 parseExplorerFilters defaults", () => {
  it("returns the documented defaults with reference set to today for empty input", () => {
    expect(parseExplorerFilters(new URLSearchParams(), TODAY)).toEqual(
      defaults(),
    );
    expect(parseExplorerFilters({}, TODAY)).toEqual(defaults());
  });

  it("produces a server-safe query from the default view", () => {
    expectServerSafe(parseExplorerFilters({}, TODAY));
  });
});

describe("GH-30 UNIT-002 parseExplorerFilters hostile input", () => {
  it("falls back to the defaults for garbage and never represents a Combined scope", () => {
    const filters = parseExplorerFilters(
      new URLSearchParams({
        scope: "combined",
        status: "maybe",
        reference: "2026-02-30",
      }),
      TODAY,
    );
    expect(filters).toEqual(defaults());
    expect(filters.scope).toBe("family");
    // `ExplorerScope` has no Combined member; assert the runtime value too, so
    // a widened implementation cannot smuggle one through the URL.
    expect(["family", "personal"]).toContain(filters.scope);
    expectServerSafe(filters);
  });

  it("falls back to today for a syntactically valid but non-existent calendar date", () => {
    for (const reference of [
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "0000-00-00",
      "2026-8-3",
      "20260803",
      "not-a-date",
      "",
    ]) {
      const filters = parseExplorerFilters({ reference }, TODAY);
      expect(filters.reference, `reference=${reference}`).toBe(TODAY);
      expectServerSafe(filters);
    }
  });

  it("keeps a real calendar date, including a genuine leap day", () => {
    expect(parseExplorerFilters({ reference: "2024-02-29" }, TODAY)).toEqual(
      defaults("2024-02-29"),
    );
  });

  it("never throws and never yields a server-rejectable value for hostile input", () => {
    const hostile: Array<
      URLSearchParams | Record<string, string | string[] | undefined>
    > = [
      new URLSearchParams(
        `scope=combined&period=quarter&reference=2026-02-30&status=maybe&inclusion=nope&accountId=1%27%3B+DROP+TABLE+t&categoryId=%00&search=${"x".repeat(500)}`,
      ),
      new URLSearchParams("scope=&period=&reference=&status=&inclusion="),
      new URLSearchParams("scope=FAMILY&period=MONTH&status=ALL"),
      { scope: undefined, period: undefined, reference: undefined },
      { search: "   ", accountId: "   ", categoryId: "   " },
      { accountId: "not-a-uuid", categoryId: "../../etc/passwd" },
      { search: "<script>alert(1)</script>" },
      { search: "y".repeat(10_000) },
      { period: "custom", from: "abc", to: "def" },
      { scope: ["personal"], status: ["pending", "posted"] },
      JSON.parse('{"__proto__":{"polluted":true},"scope":"combined"}'),
      { reference: null, scope: 42, period: ["custom"] } as unknown as Record<
        string,
        string
      >,
    ];
    for (const raw of hostile) {
      const label = raw instanceof URLSearchParams ? raw.toString() : "record";
      expect(() => parseExplorerFilters(raw, TODAY), label).not.toThrow();
      const filters = parseExplorerFilters(raw, TODAY);
      expect(["family", "personal"], label).toContain(filters.scope);
      expect(["day", "week", "month", "custom"], label).toContain(
        filters.period,
      );
      expect(["all", "pending", "posted"], label).toContain(filters.status);
      expect(
        ["default", "included", "excluded", "transfers", "all"],
        label,
      ).toContain(filters.inclusion);
      // `search` is `.max(100)` server-side, so an over-long value has to be
      // clamped here rather than rejected there.
      expect(filters.search.length, label).toBeLessThanOrEqual(100);
      expectServerSafe(filters);
    }
    // Prototype pollution attempt must not have taken.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("accepts Next's searchParams record shape, including a repeated key", () => {
    expect(
      parseExplorerFilters({ scope: ["personal"], status: ["pending"] }, TODAY),
    ).toEqual({ ...defaults(), scope: "personal", status: "pending" });

    const repeated = parseExplorerFilters(
      { status: ["pending", "posted"], scope: ["personal", "family"] },
      TODAY,
    );
    expect(["pending", "posted"]).toContain(repeated.status);
    expect(["family", "personal"]).toContain(repeated.scope);
    expectServerSafe(repeated);
  });

  it("reads the same values from a URLSearchParams and from a plain record", () => {
    const query = {
      scope: "personal",
      period: "week",
      reference: "2026-08-12",
      status: "pending",
      inclusion: "transfers",
      search: "green market",
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
    };
    expect(parseExplorerFilters(new URLSearchParams(query), TODAY)).toEqual(
      parseExplorerFilters(query, TODAY),
    );
  });
});

describe("GH-30 UNIT-003 custom period degradation", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["both bounds missing", { period: "custom" }],
    ["only from", { period: "custom", from: "2026-08-03" }],
    ["only to", { period: "custom", to: "2026-08-09" }],
    ["empty bounds", { period: "custom", from: "", to: "" }],
    ["malformed from", { period: "custom", from: "abc", to: "2026-08-09" }],
    ["malformed to", { period: "custom", from: "2026-08-03", to: "09-08-26" }],
    [
      "non-existent calendar bound",
      { period: "custom", from: "2026-02-30", to: "2026-03-09" },
    ],
    [
      "inverted range",
      { period: "custom", from: "2026-08-09", to: "2026-08-03" },
    ],
  ];

  it.each(cases)("degrades to month when %s", (label, raw) => {
    const filters = parseExplorerFilters(raw, TODAY);
    expect(filters.period, label).toBe("month");
    // The degraded period must not carry the rejected range into a request.
    const query = toReadModelQuery(filters);
    expect(query, label).not.toHaveProperty("from");
    expect(query, label).not.toHaveProperty("to");
    // Whether the surviving bound is retained for the custom form or cleared is
    // the implementation's call, but a bound that is not a real calendar date
    // must never be retained under either choice.
    for (const bound of [filters.from, filters.to]) {
      expect(bound === "" || CALENDAR_DATE.test(bound), label).toBe(true);
    }
    expect(filters.reference, label).toBe(TODAY);
    // Whatever is retained still has to round-trip through the URL.
    expect(
      parseExplorerFilters(toExplorerSearchParams(filters), TODAY),
    ).toEqual(filters);
    expectServerSafe(filters);
  });

  it("drops a malformed bound rather than retaining it", () => {
    expect(
      parseExplorerFilters(
        { period: "custom", from: "abc", to: "2026-08-09" },
        TODAY,
      ).from,
    ).toBe("");
    expect(
      parseExplorerFilters(
        { period: "custom", from: "2026-08-03", to: "2026-02-30" },
        TODAY,
      ).to,
    ).toBe("");
    expect(
      parseExplorerFilters({ period: "custom", from: "abc", to: "def" }, TODAY),
    ).toEqual(defaults());
  });

  it("keeps a single-day custom range, which is valid rather than inverted", () => {
    const filters = parseExplorerFilters(
      { period: "custom", from: "2026-08-09", to: "2026-08-09" },
      TODAY,
    );
    expect(filters.period).toBe("custom");
    expect(filters.from).toBe("2026-08-09");
    expect(filters.to).toBe("2026-08-09");
    expectServerSafe(filters);
  });
});

describe("GH-30 UNIT-004 custom period reference resolution", () => {
  it("resolves reference to the end of a valid custom range", () => {
    expect(
      parseExplorerFilters(
        { period: "custom", from: "2026-03-02", to: "2026-03-08" },
        TODAY,
      ),
    ).toEqual({
      ...defaults("2026-03-08"),
      period: "custom",
      from: "2026-03-02",
      to: "2026-03-08",
    });
  });

  it("lets the custom range win over a conflicting reference in the URL", () => {
    const filters = parseExplorerFilters(
      {
        period: "custom",
        from: "2026-03-02",
        to: "2026-03-08",
        reference: "2026-01-01",
      },
      TODAY,
    );
    expect(filters.reference).toBe("2026-03-08");
    expectServerSafe(filters);
  });
});

describe("GH-30 UNIT-005 toReadModelQuery for a non-custom period", () => {
  it("omits every empty optional and survives dashboardQuerySchema with a limit", () => {
    const filters: ExplorerFilters = {
      ...defaults(),
      scope: "personal",
      period: "week",
      reference: "2026-08-14",
    };
    const query = toReadModelQuery(filters);
    for (const key of ["from", "to", "search", "accountId", "categoryId"]) {
      expect(query, `query must omit ${key}`).not.toHaveProperty(key);
    }
    for (const key of Object.keys(query)) {
      expect(ALLOWED_QUERY_KEYS).toContain(key);
    }
    for (const value of Object.values(query)) {
      expect(typeof value).toBe("string");
    }

    const parsed = dashboardQuerySchema.safeParse({ ...query, limit: "50" });
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      scope: "personal",
      period: "week",
      reference: "2026-08-14",
      status: "all",
      inclusion: "default",
      limit: 50,
    });
    expect(parsed.data?.from).toBeUndefined();
    expect(parsed.data?.to).toBeUndefined();
    expect(parsed.data?.search).toBeUndefined();
    expect(parsed.data?.accountId).toBeUndefined();
    expect(parsed.data?.categoryId).toBeUndefined();
  });
});

describe("GH-30 UNIT-006 toReadModelQuery for a fully-populated custom filter set", () => {
  const filters: ExplorerFilters = {
    scope: "family",
    period: "custom",
    reference: "2026-08-09",
    from: "2026-08-03",
    to: "2026-08-09",
    search: "green market",
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    status: "posted",
    inclusion: "excluded",
  };

  it("emits exactly the strict export query", () => {
    expect(toReadModelQuery(filters)).toEqual({
      scope: "family",
      period: "custom",
      reference: "2026-08-09",
      from: "2026-08-03",
      to: "2026-08-09",
      search: "green market",
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      status: "posted",
      inclusion: "excluded",
    });
  });

  it("survives dashboardExportQuerySchema unchanged", () => {
    const query = toReadModelQuery(filters);
    const parsed = dashboardExportQuerySchema.safeParse(query);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      scope: "family",
      period: "custom",
      reference: "2026-08-09",
      from: "2026-08-03",
      to: "2026-08-09",
      search: "green market",
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      status: "posted",
      inclusion: "excluded",
    });
  });

  it("also survives dashboardQuerySchema at the maximum page limit", () => {
    const parsed = dashboardQuerySchema.safeParse({
      ...toReadModelQuery(filters),
      limit: "100",
    });
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });
});

describe("GH-30 UNIT-007 toExplorerSearchParams round-trip", () => {
  const table: Array<[string, ExplorerFilters]> = [
    ["the default view", defaults()],
    [
      "a day period in Personal",
      { ...defaults("2026-01-05"), scope: "personal", period: "day" },
    ],
    [
      "a week period with search and status",
      {
        ...defaults("2026-08-12"),
        period: "week",
        search: "coffee",
        status: "pending",
      },
    ],
    ["an account-only narrowing", { ...defaults(), accountId: ACCOUNT_ID }],
    [
      "a category-only narrowing with a non-default inclusion",
      { ...defaults(), categoryId: CATEGORY_ID, inclusion: "transfers" },
    ],
    [
      "a custom range",
      {
        ...defaults("2026-08-09"),
        period: "custom",
        from: "2026-08-03",
        to: "2026-08-09",
      },
    ],
    [
      "a fully-populated custom filter set",
      {
        scope: "personal",
        period: "custom",
        reference: "2026-08-09",
        from: "2026-08-03",
        to: "2026-08-09",
        search: "café & market",
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
        status: "posted",
        inclusion: "all",
      },
    ],
  ];

  it.each(table)("is the identity for %s", (_label, filters) => {
    const search = toExplorerSearchParams(filters);
    expect(parseExplorerFilters(search, TODAY)).toEqual(filters);
    expect(parseExplorerFilters(new URLSearchParams(search), TODAY)).toEqual(
      filters,
    );
    expect(
      parseExplorerFilters(
        Object.fromEntries(new URLSearchParams(search)),
        TODAY,
      ),
    ).toEqual(filters);
    expectServerSafe(filters);
  });

  it("leaves the default view with a clean URL carrying only the anchor date", () => {
    const search = new URLSearchParams(toExplorerSearchParams(defaults()));
    expect([...search.keys()]).toEqual(["reference"]);
    expect(search.get("reference")).toBe(TODAY);
  });

  it("omits keys whose value equals the default", () => {
    const search = new URLSearchParams(
      toExplorerSearchParams({ ...defaults(), search: "coffee" }),
    );
    expect(search.get("search")).toBe("coffee");
    for (const key of [
      "scope",
      "period",
      "from",
      "to",
      "accountId",
      "categoryId",
      "status",
      "inclusion",
    ]) {
      expect(search.has(key), `default ${key} must be omitted`).toBe(false);
    }
  });

  it("emits a stable key order regardless of property insertion order", () => {
    const a: ExplorerFilters = {
      scope: "personal",
      period: "custom",
      reference: "2026-08-09",
      from: "2026-08-03",
      to: "2026-08-09",
      search: "coffee",
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      status: "posted",
      inclusion: "all",
    };
    const b: ExplorerFilters = {
      inclusion: "all",
      status: "posted",
      categoryId: CATEGORY_ID,
      accountId: ACCOUNT_ID,
      search: "coffee",
      to: "2026-08-09",
      from: "2026-08-03",
      reference: "2026-08-09",
      period: "custom",
      scope: "personal",
    };
    expect(toExplorerSearchParams(a)).toBe(toExplorerSearchParams(b));
    expect(toExplorerSearchParams(a)).toBe(toExplorerSearchParams({ ...a }));
  });

  it("never emits a Combined scope", () => {
    for (const [, filters] of table) {
      expect(toExplorerSearchParams(filters)).not.toMatch(/combined/i);
    }
  });
});

describe("GH-30 UNIT-008 describeActiveFilters", () => {
  const options = {
    accounts: [
      { id: ACCOUNT_ID, name: "Household Chequing" },
      { id: OTHER_ACCOUNT_ID, name: "Private Savings" },
    ],
    categories: [{ id: CATEGORY_ID, name: "Groceries" }],
  };

  it("names search, account, category, status and inclusion, resolving UUIDs to display names", () => {
    const labels = describeActiveFilters(
      {
        scope: "personal",
        period: "custom",
        reference: "2026-08-09",
        from: "2026-08-03",
        to: "2026-08-09",
        search: "green market",
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
        status: "posted",
        inclusion: "excluded",
      },
      options,
    );
    expect(labels).toHaveLength(5);
    for (const label of labels) {
      expect(typeof label).toBe("string");
      expect(label.trim()).not.toBe("");
    }
    const text = labels.join(" | ");
    expect(text).toContain("green market");
    expect(text).toContain("Household Chequing");
    expect(text).toContain("Groceries");
    expect(text).toMatch(/posted/i);
    expect(text).toMatch(/excluded/i);
    // Raw UUIDs are an implementation detail; the empty state shows names.
    expect(text).not.toContain(ACCOUNT_ID);
    expect(text).not.toContain(CATEGORY_ID);
    // Scope and period do not narrow the set and are not listed.
    expect(text).not.toMatch(/family|personal/i);
    expect(text).not.toMatch(
      /\bday\b|\bweek\b|\bmonth\b|\bcustom\b|\bperiod\b/i,
    );
    expect(text).not.toContain("2026-08-03");
    expect(text).not.toContain("2026-08-09");
  });

  it("lists nothing when no filter narrows the set, in either scope or any period", () => {
    expect(describeActiveFilters(defaults(), options)).toEqual([]);
    expect(
      describeActiveFilters(
        { ...defaults(), scope: "personal", period: "day" },
        options,
      ),
    ).toEqual([]);
    expect(
      describeActiveFilters(
        {
          ...defaults("2026-08-09"),
          period: "custom",
          from: "2026-08-03",
          to: "2026-08-09",
        },
        options,
      ),
    ).toEqual([]);
  });

  it("lists only the filters that are actually applied", () => {
    expect(
      describeActiveFilters({ ...defaults(), search: "coffee" }, options),
    ).toHaveLength(1);
    expect(
      describeActiveFilters(
        { ...defaults(), status: "pending", inclusion: "transfers" },
        options,
      ),
    ).toHaveLength(2);
    const accountOnly = describeActiveFilters(
      { ...defaults(), accountId: OTHER_ACCOUNT_ID },
      options,
    );
    expect(accountOnly).toHaveLength(1);
    expect(accountOnly[0]).toContain("Private Savings");
    expect(accountOnly[0]).not.toContain("Household Chequing");
  });
});
