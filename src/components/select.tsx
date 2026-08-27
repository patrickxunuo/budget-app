"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  keywords?: readonly string[];
};

export type SelectProps = {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  placeholder?: string;
  variant?: "default" | "compact";
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
};

export type SearchableSelectProps = SelectProps & {
  searchPlaceholder?: string;
  emptyMessage?: string;
};

type Placement = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
};
type SharedProps = SearchableSelectProps & { searchable: boolean };

const OPEN_EVENT = "piggy-select-open";
const VIEWPORT_GUTTER = 12;
const MENU_MAX_HEIGHT = 320;

function enabledIndex(
  options: readonly SelectOption[],
  start: number,
  direction: 1 | -1,
) {
  if (options.length === 0) return -1;
  let index = start;
  for (let count = 0; count < options.length; count += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function edgeEnabledIndex(options: readonly SelectOption[], direction: 1 | -1) {
  const start = direction === 1 ? -1 : options.length;
  return enabledIndex(options, start, direction);
}

function CheckMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none">
      <path
        d="m3 8.25 3.15 3.15L13 4.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SelectBase({
  options,
  value,
  defaultValue = "",
  onValueChange,
  name,
  id,
  disabled = false,
  required = false,
  invalid = false,
  placeholder = "Choose an option",
  variant = "default",
  className = "",
  searchable,
  searchPlaceholder = "Search options",
  emptyMessage = "No matching options",
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "data-testid": testId,
}: SharedProps) {
  const generatedId = useId().replaceAll(":", "");
  const triggerId = id ?? `piggy-select-${generatedId}`;
  const listboxId = `${triggerId}-listbox`;
  const searchId = `${triggerId}-search`;
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentValue = (controlled ? value : internalValue) ?? "";
  const selected = options.find((option) => option.value === currentValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [validationInvalid, setValidationInvalid] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!searchable || !needle) return options;
    return options.filter((option) =>
      [option.label, ...(option.keywords ?? [])].some((word) =>
        word.toLocaleLowerCase().includes(needle),
      ),
    );
  }, [options, query, searchable]);

  const effectiveActiveIndex =
    filteredOptions[activeIndex] && !filteredOptions[activeIndex]?.disabled
      ? activeIndex
      : edgeEnabledIndex(filteredOptions, 1);
  const activeOption = filteredOptions[effectiveActiveIndex];
  const activeId = activeOption
    ? `${listboxId}-option-${effectiveActiveIndex}`
    : undefined;

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openMenu = useCallback(
    (edge?: "first" | "last") => {
      if (disabled) return;
      window.dispatchEvent(
        new CustomEvent(OPEN_EVENT, { detail: { id: triggerId } }),
      );
      setOpen(true);
      const selectedIndex = filteredOptions.findIndex(
        (option) => option.value === currentValue && !option.disabled,
      );
      setActiveIndex(
        edge === "first"
          ? edgeEnabledIndex(filteredOptions, 1)
          : edge === "last"
            ? edgeEnabledIndex(filteredOptions, -1)
            : selectedIndex >= 0
              ? selectedIndex
              : edgeEnabledIndex(filteredOptions, 1),
      );
    },
    [currentValue, disabled, filteredOptions, triggerId],
  );

  const choose = useCallback(
    (option: SelectOption | undefined) => {
      if (!option || option.disabled) return;
      if (!controlled) setInternalValue(option.value);
      setValidationInvalid(false);
      if (option.value !== currentValue) onValueChange?.(option.value);
      close(true);
    },
    [close, controlled, currentValue, onValueChange],
  );

  const moveActive = useCallback(
    (direction: 1 | -1) => {
      setActiveIndex((current) => {
        const validCurrent =
          filteredOptions[current] && !filteredOptions[current]?.disabled;
        const start = validCurrent
          ? current
          : direction === 1
            ? -1
            : filteredOptions.length;
        return enabledIndex(filteredOptions, start, direction);
      });
    },
    [filteredOptions],
  );

  useEffect(() => {
    if (!open) return;
    const onOtherOpen = (event: Event) => {
      const otherId = (event as CustomEvent<{ id: string }>).detail.id;
      if (otherId !== triggerId) close(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      )
        close(false);
    };
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOtherOpen);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close, open, triggerId]);

  useEffect(() => {
    if (!open) return;
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, searchable]);

  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, open]);

  useEffect(() => {
    const form = triggerRef.current?.closest("form");
    if (!form || controlled) return;
    const reset = () => {
      setInternalValue(defaultValue);
      close(false);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [close, controlled, defaultValue]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const availableWidth = window.innerWidth - VIEWPORT_GUTTER * 2;
      const width = Math.min(Math.max(rect.width, 240), availableWidth);
      const left = Math.min(
        Math.max(VIEWPORT_GUTTER, rect.left),
        window.innerWidth - VIEWPORT_GUTTER - width,
      );
      const below = window.innerHeight - rect.bottom - VIEWPORT_GUTTER;
      const above = rect.top - VIEWPORT_GUTTER;
      const opensAbove = below < 180 && above > below;
      const maxHeight = Math.min(
        MENU_MAX_HEIGHT,
        Math.max(120, opensAbove ? above - 6 : below - 6),
      );
      setPlacement({
        left,
        top: opensAbove ? undefined : rect.bottom + 6,
        bottom: opensAbove ? window.innerHeight - rect.top + 6 : undefined,
        width,
        maxHeight,
      });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    },
    [],
  );

  function handleTypeahead(key: string) {
    typeaheadRef.current += key.toLocaleLowerCase();
    if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    typeaheadTimer.current = setTimeout(() => {
      typeaheadRef.current = "";
    }, 650);
    const start = Math.max(effectiveActiveIndex, -1);
    for (let offset = 1; offset <= filteredOptions.length; offset += 1) {
      const index = (start + offset) % filteredOptions.length;
      const option = filteredOptions[index];
      if (
        option &&
        !option.disabled &&
        option.label.toLocaleLowerCase().startsWith(typeaheadRef.current)
      ) {
        setActiveIndex(index);
        document
          .getElementById(`${listboxId}-option-${index}`)
          ?.scrollIntoView?.({ block: "nearest" });
        break;
      }
    }
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu(event.key === "ArrowDown" ? "first" : "last");
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && !searchable) choose(activeOption);
      else if (!open) openMenu();
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!searchable && open && event.key === "Home") {
      event.preventDefault();
      setActiveIndex(edgeEnabledIndex(filteredOptions, 1));
      return;
    }
    if (!searchable && open && event.key === "End") {
      event.preventDefault();
      setActiveIndex(edgeEnabledIndex(filteredOptions, -1));
      return;
    }
    if (!searchable && event.key.length === 1 && /\S/.test(event.key)) {
      if (!open) openMenu();
      handleTypeahead(event.key);
    }
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(edgeEnabledIndex(filteredOptions, 1));
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(edgeEnabledIndex(filteredOptions, -1));
    } else if (event.key === "Enter" || (!searchable && event.key === " ")) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (!searchable && event.key.length === 1 && /\S/.test(event.key)) {
      handleTypeahead(event.key);
    }
  }

  const menu = open && placement && (
    <div
      ref={menuRef}
      data-piggy-select-portal-for={triggerId}
      className="piggy-select-menu border-line bg-surface text-ink fixed z-[1200] overflow-hidden rounded-xl border shadow-[0_20px_55px_color-mix(in_srgb,var(--ink)_20%,transparent)]"
      style={{
        left: placement.left,
        top: placement.top,
        bottom: placement.bottom,
        width: placement.width,
        maxWidth: `calc(100vw - ${VIEWPORT_GUTTER * 2}px)`,
      }}
    >
      <div className="border-brand bg-panel border-t-[3px]">
        {searchable && (
          <div className="border-line-soft border-b p-2.5">
            <div className="border-line bg-background focus-within:border-focus focus-within:outline-focus flex min-h-11 items-center gap-2 rounded-lg border px-3 focus-within:outline-2 focus-within:outline-offset-1">
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="text-muted size-4 shrink-0"
                fill="none"
              >
                <circle
                  cx="8.5"
                  cy="8.5"
                  r="5.25"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="m12.5 12.5 4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                ref={searchRef}
                id={searchId}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={activeId}
                aria-label={searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onListKeyDown}
                placeholder={searchPlaceholder}
                className="text-ink placeholder:text-muted min-w-0 flex-1 bg-transparent text-base outline-none"
              />
              <span className="font-utility text-muted text-[.58rem] tracking-[.12em] uppercase">
                {filteredOptions.length}
              </span>
            </div>
          </div>
        )}
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={ariaLabel ? undefined : triggerId}
          aria-label={ariaLabel}
          aria-activedescendant={activeId}
          tabIndex={searchable ? -1 : 0}
          onKeyDown={onListKeyDown}
          className="divide-line-soft divide-y overflow-y-auto overscroll-contain outline-none"
          style={{ maxHeight: placement.maxHeight - (searchable ? 69 : 0) }}
        >
          {filteredOptions.length === 0 ? (
            <div className="text-muted px-4 py-8 text-center text-sm">
              <span aria-hidden="true" className="font-display text-2xl">
                ∅
              </span>
              <p className="mt-1">{emptyMessage}</p>
            </div>
          ) : (
            filteredOptions.map((option, index) => {
              const selectedOption = option.value === currentValue;
              const active = index === effectiveActiveIndex;
              return (
                <div
                  key={`${option.value}-${index}`}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={selectedOption}
                  aria-disabled={option.disabled || undefined}
                  data-active={active ? "true" : "false"}
                  data-selected={selectedOption ? "true" : "false"}
                  data-value={option.value}
                  onPointerMove={() =>
                    !option.disabled && setActiveIndex(index)
                  }
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  className="group data-[active=true]:bg-panel data-[selected=true]:text-brand relative grid min-h-12 cursor-default grid-cols-[1fr_1.5rem] items-center gap-3 px-4 py-2.5 text-sm transition-colors aria-disabled:pointer-events-none aria-disabled:opacity-45 data-[active=true]:pl-5 data-[selected=true]:font-semibold"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="text-muted mt-0.5 block truncate text-xs font-normal">
                        {option.description}
                      </span>
                    )}
                  </span>
                  <span className="flex size-5 items-center justify-center">
                    {selectedOption ? <CheckMark /> : null}
                  </span>
                  {active && (
                    <span
                      aria-hidden="true"
                      className="bg-brand absolute inset-y-2 left-0 w-0.5 rounded-full"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && !searchable ? activeId : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-disabled={disabled || undefined}
        aria-required={required || undefined}
        aria-invalid={
          invalid || (validationInvalid && !currentValue) || undefined
        }
        disabled={disabled}
        data-testid={testId}
        data-value={currentValue}
        onClick={() => (open ? close(true) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={`border-line bg-surface text-ink focus-visible:outline-focus disabled:text-muted group hover:border-brand flex w-full min-w-0 items-center justify-between gap-3 border px-3 text-left font-sans font-normal tracking-normal normal-case shadow-[inset_0_1px_0_color-mix(in_srgb,var(--surface)_70%,transparent)] transition-[border-color,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${variant === "compact" ? "min-h-9 rounded-lg py-1.5 text-sm" : "min-h-11 rounded-xl py-2.5 text-base"} ${invalid ? "border-alert" : ""} ${className}`}
      >
        <span
          className={`min-w-0 flex-1 truncate ${selected ? "" : "text-muted"}`}
        >
          {selected?.label ?? placeholder}
        </span>
        <span
          aria-hidden="true"
          className="border-line text-muted flex size-6 shrink-0 items-center justify-center rounded-md border transition-transform group-aria-expanded:rotate-180"
        >
          <svg viewBox="0 0 16 16" className="size-3" fill="none">
            <path
              d="m3.5 6 4.5 4 4.5-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {(name || required) && (
        <input
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          value={currentValue}
          required={required}
          disabled={disabled}
          onChange={() => undefined}
          onInvalid={(event) => {
            event.preventDefault();
            setValidationInvalid(true);
            triggerRef.current?.focus();
          }}
        />
      )}
      {searchable && (
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {open && query
            ? `${filteredOptions.length} result${filteredOptions.length === 1 ? "" : "s"} available.`
            : ""}
        </span>
      )}
      {menu && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : null}
    </>
  );
}

export function Select(props: SelectProps) {
  return <SelectBase {...props} searchable={false} />;
}

export function SearchableSelect(props: SearchableSelectProps) {
  return <SelectBase {...props} searchable />;
}
