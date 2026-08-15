"use client";

import { useEffect, useRef } from "react";

/**
 * The polite busy announcement every route skeleton carries.
 *
 * The region mounts empty and is filled after commit, because a `role="status"`
 * element that arrives with its text already inside it is not announced:
 * assistive technology reports *changes* to a live region, not whatever it was
 * born holding. Rendering `{message}` directly would produce a region that
 * satisfies a DOM assertion and stays silent.
 *
 * The text is written through the node rather than held in state on purpose.
 * The accessibility tree is the external system this effect synchronises, and
 * nothing in React needs to re-render when it changes.
 */
export function SkeletonAnnouncement({ message }: { message: string }) {
  const region = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const node = region.current;
    if (node) node.textContent = message;
  }, [message]);

  return (
    <p
      ref={region}
      role="status"
      data-testid="route-skeleton-status"
      className="sr-only"
    />
  );
}
