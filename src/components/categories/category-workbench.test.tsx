import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CategoryWorkbench } from "./category-workbench";

const familyCategory = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Groceries",
  color: "#18745B",
  scope: "family" as const,
  ownerProfileId: null,
  systemKey: null,
  archivedAt: null,
  inUse: true,
};
const personalCategory = {
  ...familyCategory,
  id: "30000000-0000-4000-8000-000000000002",
  name: "Quiet treats",
  scope: "personal" as const,
  ownerProfileId: "10000000-0000-4000-8000-000000000001",
  inUse: false,
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GH-7 category workbench acceptance", () => {
  it("FE-001 creates Family and Personal categories and presents explicit privacy labels", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        jsonResponse({ category: familyCategory }, 201),
      )
      .mockImplementationOnce(() =>
        jsonResponse({ category: personalCategory }, 201),
      );

    render(<CategoryWorkbench initialCategories={[]} initialRules={[]} />);

    expect(screen.getByTestId("category-workbench")).toBeVisible();
    expect(screen.getByTestId("category-name")).toHaveAccessibleName(
      /category name/i,
    );
    expect(screen.getByTestId("category-color")).toHaveAccessibleName(/ink/i);
    expect(screen.getByTestId("category-scope")).toHaveAccessibleName(
      /privacy/i,
    );
    expect(screen.getByText(/visible to household/i)).toBeVisible();
    expect(screen.getByText(/only visible to you/i)).toBeVisible();

    fireEvent.change(screen.getByTestId("category-name"), {
      target: { value: "Groceries" },
    });
    fireEvent.change(screen.getByTestId("category-color"), {
      target: { value: "#18745b" },
    });
    fireEvent.change(screen.getByTestId("category-scope"), {
      target: { value: "family" },
    });
    fireEvent.click(screen.getByTestId("category-submit"));

    await waitFor(() => expect(screen.getByText("Groceries")).toBeVisible());
    expect(screen.getByText(/in use.*labels retained/i)).toBeVisible();

    fireEvent.change(screen.getByTestId("category-name"), {
      target: { value: "Quiet treats" },
    });
    fireEvent.change(screen.getByTestId("category-scope"), {
      target: { value: "personal" },
    });
    fireEvent.click(screen.getByTestId("category-submit"));

    await waitFor(() => expect(screen.getByText("Quiet treats")).toBeVisible());
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/categories",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/categories",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("FE-002 archives an in-use custom category while explicitly retaining historical labels", async () => {
    const archived = {
      ...familyCategory,
      archivedAt: "2026-08-12T15:00:00.000Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => jsonResponse({ category: archived }));

    render(
      <CategoryWorkbench
        initialCategories={[familyCategory]}
        initialRules={[]}
      />,
    );

    const categoryName = screen.getByText("Groceries");
    const categoryRegion = categoryName.closest("article");
    expect(categoryRegion).not.toBeNull();
    expect(
      within(categoryRegion as HTMLElement).getByText(/in use/i),
    ).toBeVisible();

    fireEvent.click(
      within(categoryRegion as HTMLElement).getByRole("button", {
        name: /archive/i,
      }),
    );

    await waitFor(() =>
      expect(
        within(categoryRegion as HTMLElement).getByText(/archived/i),
      ).toBeVisible(),
    );
    expect(screen.getByText("Groceries")).toBeVisible();
    expect(screen.getByText(/historical labels are retained/i)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/categories/${familyCategory.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
    );
  });
});
