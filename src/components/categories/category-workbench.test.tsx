import {
  act,
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

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function chooseScope(label: "Family" | "Personal") {
  fireEvent.click(screen.getByTestId("category-scope"));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(label, "i") }));
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
    chooseScope("Family");
    fireEvent.click(screen.getByTestId("category-submit"));

    await waitFor(() => expect(screen.getByText("Groceries")).toBeVisible());
    expect(screen.getByText(/in use.*labels retained/i)).toBeVisible();

    fireEvent.change(screen.getByTestId("category-name"), {
      target: { value: "Quiet treats" },
    });
    chooseScope("Personal");
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

describe("GH-33 category workbench pending controls", () => {
  it("FE-005 shares pending across create and archive, ignores repeats, and restores existing failure copy", async () => {
    const createRequest = deferredResponse();
    const archiveRequest = deferredResponse();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => createRequest.promise)
      .mockImplementationOnce(() => archiveRequest.promise);

    render(
      <CategoryWorkbench
        initialCategories={[familyCategory, personalCategory]}
        initialRules={[]}
      />,
    );

    fireEvent.change(screen.getByTestId("category-name"), {
      target: { value: "Utilities" },
    });
    const submit = screen.getByTestId("category-submit");
    act(() => {
      submit.click();
      submit.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(submit).toHaveTextContent("Saving…");
    expect(submit).toHaveAttribute("data-pending", "true");
    expect(submit).toBeDisabled();
    for (const archive of screen.getAllByRole("button", { name: "Archive" })) {
      expect(archive).toBeDisabled();
    }

    await act(async () => {
      createRequest.resolve(
        new Response(
          JSON.stringify({ error: "Category could not be saved. Try again." }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        ),
      );
      await createRequest.promise;
    });
    await waitFor(() =>
      expect(
        screen.getByText("Category could not be saved. Try again."),
      ).toBeVisible(),
    );
    expect(submit).toHaveTextContent("Add category");
    expect(submit).toHaveAttribute("data-pending", "false");
    expect(submit).toBeEnabled();

    const groceryArticle = screen.getByText("Groceries").closest("article");
    expect(groceryArticle).not.toBeNull();
    const archive = within(groceryArticle as HTMLElement).getByRole("button", {
      name: "Archive",
    });
    act(() => {
      archive.click();
      archive.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(archive).toHaveTextContent("Archiving…");
    expect(archive).toHaveAttribute("data-pending", "true");
    expect(archive).toBeDisabled();
    expect(submit).toBeDisabled();
    for (const otherArchive of screen.getAllByRole("button", {
      name: "Archive",
    })) {
      expect(otherArchive).toBeDisabled();
    }

    await act(async () => {
      archiveRequest.resolve(
        new Response(JSON.stringify({ error: "Archive failed. Try again." }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      );
      await archiveRequest.promise;
    });
    await waitFor(() =>
      expect(screen.getByText("Archive failed. Try again.")).toBeVisible(),
    );
    expect(archive).toHaveTextContent("Archive");
    expect(archive).toHaveAttribute("data-pending", "false");
    expect(archive).toBeEnabled();
    expect(submit).toBeEnabled();
  });
});
