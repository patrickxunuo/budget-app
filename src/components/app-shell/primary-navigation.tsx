"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavigationItem = {
  href: string;
  label: string;
  index: string;
};

/**
 * The five destinations a member reaches one-handed. They are the bottom bar
 * below `lg`, and the top of the rail above it, so the ordering is shared.
 */
export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/dashboard", label: "Overview", index: "01" },
  { href: "/accounts", label: "Accounts", index: "02" },
  { href: "/transactions", label: "Transactions", index: "03" },
  { href: "/budgets", label: "Budgets", index: "04" },
  { href: "/categories", label: "Categories", index: "05" },
];

/** Administrative destinations: rail only, never in the thumb-reach bar. */
export const SECONDARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/settings/members", label: "Household", index: "06" },
];

/**
 * A link is active for its own route and everything nested beneath it, but the
 * `/` boundary matters: `/account` must not light up `/accounts`.
 */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A small filled bar so the active state survives a colour-blind reading. */
function ActiveIndicator({ className }: { className: string }) {
  return (
    <span
      data-testid="nav-active-indicator"
      aria-hidden="true"
      className={`bg-brand rounded-full ${className}`}
    />
  );
}

export function NavigationRail() {
  const pathname = usePathname();
  const items = [...PRIMARY_NAVIGATION, ...SECONDARY_NAVIGATION];
  return (
    <nav aria-label="Primary" className="hidden px-3 py-4 lg:block lg:pt-8">
      {items.map((item, position) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`text-ink hover:bg-surface focus-visible:outline-focus flex min-h-11 items-center justify-between gap-3 rounded-xl px-3.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${
              position > 0 ? "mt-1" : ""
            } ${active ? "bg-surface border-line border font-bold" : "font-semibold"}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {active ? <ActiveIndicator className="h-4 w-1 shrink-0" /> : null}
              <span className="truncate">{item.label}</span>
            </span>
            <span className="font-utility text-brand shrink-0 text-[.62rem]">
              {item.index}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNavigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      data-testid="mobile-bottom-nav"
      // `.safe-bottom` supplies the home-indicator inset; the links carry their
      // own padding so the two never fight over the same declaration.
      className="safe-bottom border-line bg-panel fixed inset-x-0 bottom-0 z-40 border-t lg:hidden"
    >
      <ul className="safe-x mx-auto flex w-full max-w-2xl items-stretch">
        {PRIMARY_NAVIGATION.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`text-ink focus-visible:outline-focus flex min-h-14 w-full min-w-11 flex-col items-center justify-center gap-1 px-1 py-2 text-center focus-visible:outline-2 focus-visible:-outline-offset-2 ${
                  active ? "text-brand-strong" : ""
                }`}
              >
                {active ? (
                  <ActiveIndicator className="h-1 w-6 shrink-0" />
                ) : (
                  <span aria-hidden="true" className="h-1 w-6 shrink-0" />
                )}
                <span
                  className={`w-full truncate text-[.65rem] leading-4 ${
                    active ? "font-bold" : "font-medium"
                  }`}
                >
                  {item.label}
                </span>
                <span className="font-utility text-muted text-[.6rem] leading-3 tracking-[.12em]">
                  {item.index}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
