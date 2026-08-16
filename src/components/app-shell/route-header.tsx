"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const ROUTES = [
  { href: "/dashboard", label: "Overview" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/accounts", label: "Accounts" },
  { href: "/categories", label: "Categories" },
  { href: "/settings/members", label: "Family members" },
] as const;

function routeLabel(pathname: string | null): string {
  return (
    ROUTES.find(
      ({ href }) =>
        pathname !== null &&
        (pathname === href || pathname.startsWith(`${href}/`)),
    )?.label ?? "Overview"
  );
}

export function RouteHeader() {
  const pathname = usePathname();
  const label = routeLabel(pathname);
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <div className="safe-x safe-top border-line bg-surface sticky top-0 z-20 border-b">
      <header
        data-testid="workspace-header"
        className="mx-auto flex min-h-15 w-full max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-8 lg:px-12"
      >
        <h1
          data-testid="route-heading"
          className="font-display text-ink min-w-0 truncate text-xl font-semibold tracking-[-.025em] sm:text-2xl"
        >
          {label}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <div className="relative">
            <button
              type="button"
              aria-expanded={accountOpen}
              aria-controls="account-menu"
              onClick={() => setAccountOpen((open) => !open)}
              className="border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-focus flex min-h-11 items-center rounded-xl border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Account
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className={`ml-2 size-3 ${accountOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
            {accountOpen ? (
              <div
                id="account-menu"
                className="border-line bg-surface absolute top-[calc(100%+.5rem)] right-0 z-30 grid min-w-52 overflow-hidden rounded-xl border p-1 shadow-[0_12px_30px_color-mix(in_srgb,var(--ink)_12%,transparent)]"
              >
                <Link
                  href="/install"
                  onClick={() => setAccountOpen(false)}
                  className="browser-only-install text-ink hover:bg-panel focus-visible:outline-focus flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2"
                >
                  Install app
                </Link>
                <Link
                  href="/settings/members"
                  onClick={() => setAccountOpen(false)}
                  className="text-ink hover:bg-panel focus-visible:outline-focus flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2"
                >
                  Family members
                </Link>
                <div className="border-line border-t [&_button]:w-full [&_button]:justify-start">
                  <SignOutButton />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>
    </div>
  );
}
