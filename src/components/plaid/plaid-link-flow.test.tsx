import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SuccessMetadata = {
  institution: {
    institution_id: string;
    name: string;
  } | null;
};

type PlaidConfig = {
  token?: string | null;
  onSuccess?: (publicToken: string | null, metadata: SuccessMetadata) => void;
};

const plaid = vi.hoisted(() => ({
  open: vi.fn(),
  config: undefined as PlaidConfig | undefined,
}));

vi.mock("react-plaid-link", () => ({
  usePlaidLink: (config: PlaidConfig) => {
    plaid.config = config;
    return {
      open: plaid.open,
      ready: Boolean(config.token),
      error: null,
      exit: vi.fn(),
    };
  },
}));

import { PlaidLinkFlow } from "./plaid-link-flow";

const tokenStorageKey = "budget-app.plaid-link-token";

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function reviewResponse(institution = { id: "ins-maple", name: "Maple Bank" }) {
  return {
    reviewId: "review-44",
    institution,
    accounts: [
      {
        providerAccountId: "account-44",
        name: "Everyday Chequing",
        officialName: null,
        mask: "0044",
        type: "depository",
        subtype: "checking",
        currencyCode: "CAD",
        eligible: true,
        eligibilityMessage: null,
        defaultScope: "personal",
        duplicate: null,
      },
    ],
  };
}

function installApiMock() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const path = String(input);
    if (path === "/api/plaid/link-token") {
      return response({
        linkToken: "link-gh-44",
        expiration: "2026-08-15T21:00:00.000Z",
      });
    }
    if (path === "/api/plaid/exchange") {
      return response(reviewResponse());
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

async function startLink() {
  fireEvent.click(screen.getByTestId("plaid-connect"));
  await waitFor(() =>
    expect(sessionStorage.getItem(tokenStorageKey)).toBe("link-gh-44"),
  );
  expect(plaid.config?.onSuccess).toBeTypeOf("function");
}

function exchangeCalls(fetchMock: ReturnType<typeof vi.spyOn>) {
  return fetchMock.mock.calls.filter(
    ([input]: unknown[]) => String(input) === "/api/plaid/exchange",
  );
}

function linkTokenCalls(fetchMock: ReturnType<typeof vi.spyOn>) {
  return fetchMock.mock.calls.filter(
    ([input]: unknown[]) => String(input) === "/api/plaid/link-token",
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  plaid.open.mockReset();
  plaid.config = undefined;
  sessionStorage.clear();
});

describe("GH-44 PlaidLinkFlow nullable public token", () => {
  it("rejects a null success token before exchange and offers a sanitized retry", async () => {
    const fetchMock = installApiMock();
    render(<PlaidLinkFlow />);
    await startLink();

    act(() => {
      plaid.config?.onSuccess?.(null, {
        institution: {
          institution_id: "ins-maple",
          name: "Maple Bank",
        },
      });
    });

    expect(exchangeCalls(fetchMock)).toHaveLength(0);
    expect(sessionStorage.getItem(tokenStorageKey)).toBeNull();
    expect(screen.queryByTestId("plaid-review")).not.toBeInTheDocument();
    expect(screen.getByTestId("plaid-status")).toHaveTextContent(
      "The secure bank window could not finish. Your accounts were not changed; request a fresh connection and try again.",
    );
    expect(screen.getByTestId("plaid-retry")).toBeEnabled();
    expect(screen.getByTestId("plaid-retry")).toHaveAccessibleName(
      /request a fresh connection/i,
    );

    fireEvent.click(screen.getByTestId("plaid-retry"));
    await waitFor(() => expect(linkTokenCalls(fetchMock)).toHaveLength(2));
    expect(sessionStorage.getItem(tokenStorageKey)).toBe("link-gh-44");
  });

  it("exchanges one string token with the supplied institution metadata", async () => {
    const fetchMock = installApiMock();
    render(<PlaidLinkFlow />);
    await startLink();

    act(() => {
      plaid.config?.onSuccess?.("public-gh-44", {
        institution: {
          institution_id: "ins-maple",
          name: "Maple Bank",
        },
      });
    });

    await waitFor(() => expect(exchangeCalls(fetchMock)).toHaveLength(1));
    expect(exchangeCalls(fetchMock)[0]).toEqual([
      "/api/plaid/exchange",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          publicToken: "public-gh-44",
          institution: { id: "ins-maple", name: "Maple Bank" },
        }),
      }),
    ]);
    expect(await screen.findByTestId("plaid-review")).toBeVisible();
  });

  it("preserves institution fallbacks when a string token has no institution metadata", async () => {
    const fetchMock = installApiMock();
    render(<PlaidLinkFlow />);
    await startLink();

    act(() => {
      plaid.config?.onSuccess?.("public-with-fallback", { institution: null });
    });

    await waitFor(() => expect(exchangeCalls(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(exchangeCalls(fetchMock)[0]?.[1]?.body))).toEqual({
      publicToken: "public-with-fallback",
      institution: {
        id: "unknown-institution",
        name: "Connected institution",
      },
    });
  });
});
