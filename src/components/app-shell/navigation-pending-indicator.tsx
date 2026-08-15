"use client";

import { useLinkStatus } from "next/link";

/**
 * The inline "this destination is opening" hint, rendered inside a navigation
 * `<Link>` — `useLinkStatus` only reports anything for a link it is a
 * descendant of.
 *
 * It renders in both states rather than only while pending, so the item cannot
 * change size under the pointer that just activated it; `.nav-pending` reserves
 * the box and hides it with opacity, and delays its fade so a prefetched route
 * that commits immediately never flashes a hint on the way past.
 */
export function NavigationPendingIndicator({
  className = "",
}: {
  className?: string;
}) {
  const { pending } = useLinkStatus();
  return (
    <span
      data-testid="nav-pending-indicator"
      data-pending={pending ? "true" : "false"}
      aria-hidden="true"
      className={`nav-pending ${className}`.trim()}
    >
      <span className="nav-pending-dot" />
      <span className="nav-pending-dot" />
      <span className="nav-pending-dot" />
    </span>
  );
}
