import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState, type FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { SearchableSelect, Select, type SelectOption } from "./select";

const options: readonly SelectOption[] = [
  { value: "alpha", label: "Alpha" },
  { value: "blocked", label: "Blocked", disabled: true },
  { value: "bravo", label: "Bravo", description: "Second enabled choice" },
  { value: "charlie", label: "Charlie", keywords: ["groceries", "market"] },
];

function ControlledSelect() {
  const [value, setValue] = useState("alpha");
  return (
    <Select
      aria-label="Status"
      data-testid="status-select"
      onValueChange={setValue}
      options={options}
      value={value}
    />
  );
}

function trigger() {
  return screen.getByTestId("status-select");
}

describe("GH-26 themed Select acceptance", () => {
  it("FE-001 opens by pointer, selects once, exposes selection, and restores trigger focus", async () => {
    const onValueChange = vi.fn();
    render(
      <Select
        aria-label="Status"
        data-testid="status-select"
        onValueChange={onValueChange}
        options={options}
        value="alpha"
      />,
    );

    fireEvent.click(trigger());
    const listbox = screen.getByRole("listbox");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(
      within(listbox).getByRole("option", { name: "Alpha" }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(within(listbox).getByRole("option", { name: /Bravo/ }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("bravo");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("FE-002 supports keyboard opening, enabled-option navigation, typeahead, selection, Escape, and focus return", async () => {
    render(<ControlledSelect />);

    trigger().focus();
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(screen.getByRole("listbox")).toBeVisible();

    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const afterArrowId = trigger().getAttribute("aria-activedescendant");
    expect(afterArrowId).toBeTruthy();
    expect(document.getElementById(afterArrowId!)).toHaveTextContent("Bravo");
    fireEvent.keyDown(trigger(), { key: "End" });
    fireEvent.keyDown(trigger(), { key: "Home" });
    fireEvent.keyDown(trigger(), { key: "c" });
    const activeId = trigger().getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)).toHaveTextContent("Charlie");
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(trigger()).toHaveAttribute("data-value", "charlie");
    await waitFor(() => expect(trigger()).toHaveFocus());

    fireEvent.keyDown(trigger(), { key: " " });
    expect(screen.getByRole("listbox")).toBeVisible();
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("FE-003 exposes disabled state and cannot open or change", () => {
    const onValueChange = vi.fn();
    render(
      <Select
        aria-label="Status"
        data-testid="status-select"
        disabled
        onValueChange={onValueChange}
        options={options}
        value="alpha"
      />,
    );

    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("FE-004 filters case-insensitively across keywords, announces count, selects with arrows/Enter, and resets search", async () => {
    const onValueChange = vi.fn();
    render(
      <SearchableSelect
        aria-label="Category"
        data-testid="status-select"
        onValueChange={onValueChange}
        options={options}
        searchPlaceholder="Search categories"
        value="alpha"
      />,
    );

    fireEvent.click(trigger());
    const search = screen.getByPlaceholderText("Search categories");
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: "MARKET" } });

    expect(screen.getByRole("option", { name: "Charlie" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "Alpha" }),
    ).not.toBeInTheDocument();
    const status = screen.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent(/1.*result/i));

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("charlie");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());

    fireEvent.click(trigger());
    expect(screen.getByPlaceholderText("Search categories")).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(options.length);
  });

  it("FE-005 shows an empty state without an active option and Escape closes safely", async () => {
    render(
      <SearchableSelect
        aria-label="Category"
        data-testid="status-select"
        emptyMessage="No matching categories"
        options={options}
      />,
    );

    fireEvent.click(trigger());
    const search = screen.getByRole("combobox", { name: "Search options" });
    fireEvent.change(search, { target: { value: "does-not-exist" } });
    expect(screen.getByText("No matching categories")).toBeVisible();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(search).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("FE-006 mirrors controlled/default values into FormData and focuses the visible trigger for a required empty value", async () => {
    const submitted = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      return new FormData(event.currentTarget);
    });
    const { rerender } = render(
      <form onSubmit={submitted}>
        <Select
          aria-label="Status"
          data-testid="status-select"
          defaultValue="bravo"
          name="status"
          options={options}
          required
        />
        <button type="submit">Save</button>
      </form>,
    );

    fireEvent.submit(
      screen.getByRole("button", { name: "Save" }).closest("form")!,
    );
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(
      new FormData(
        screen.getByRole("button", { name: "Save" }).closest("form")!,
      ).get("status"),
    ).toBe("bravo");

    submitted.mockClear();
    rerender(
      <form onSubmit={submitted}>
        <Select
          aria-label="Status"
          data-testid="status-select"
          name="status"
          options={options}
          required
          value=""
        />
        <button type="submit">Save</button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submitted).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(trigger()).toHaveAttribute("aria-required", "true");
    expect(trigger()).toHaveAttribute("aria-invalid", "true");
  });

  it("FE-007/FE-008 renders the portal with viewport-safe scrolling, themed tokens, and reduced-motion hooks", () => {
    render(
      <Select
        aria-label="Status"
        data-testid="status-select"
        options={options}
      />,
    );
    fireEvent.click(trigger());

    const listbox = screen.getByRole("listbox");
    const portal = listbox.closest(".piggy-select-menu")!;
    expect(document.body).toContainElement(listbox);
    expect(portal.className).toMatch(/max-w|overflow|z-/);
    expect(listbox.className).toMatch(/overflow-y|max-h/);
    expect(`${portal.className} ${listbox.className}`).toMatch(
      /surface|panel|ink|line|brand|motion-reduce/,
    );
  });

  it("FE-011 preserves trigger/search/listbox relationships and selected/disabled/invalid semantics", async () => {
    render(
      <SearchableSelect
        aria-describedby="category-help"
        aria-label="Category"
        data-testid="status-select"
        invalid
        options={options}
        required
        value="alpha"
      />,
    );

    expect(trigger()).toHaveAccessibleName("Category");
    expect(trigger()).toHaveAttribute("aria-describedby", "category-help");
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger()).toHaveAttribute("aria-invalid", "true");
    expect(trigger()).toHaveAttribute("aria-required", "true");
    fireEvent.click(trigger());

    const search = screen.getByRole("combobox", { name: "Search options" });
    const listbox = screen.getByRole("listbox");
    expect(trigger()).toHaveAttribute("aria-controls", listbox.id);
    expect(search).toHaveAttribute("aria-controls", listbox.id);
    expect(
      within(listbox).getByRole("option", { name: "Alpha" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(listbox).getByRole("option", { name: "Blocked" }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(search, { target: { value: "br" } });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/1.*result/i),
    );
  });

  it("FE-012 leaves no browser-native select under src/components", () => {
    const root = join(process.cwd(), "src", "components");
    const visit = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return visit(path);
        if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx"))
          return [];
        return /<select(?:\s|>)/.test(readFileSync(path, "utf8")) ? [path] : [];
      });

    expect(visit(root)).toEqual([]);
  });
});
