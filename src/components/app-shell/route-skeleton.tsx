import { SkeletonAnnouncement } from "@/components/app-shell/skeleton-announcement";

/**
 * Every placeholder shape in every skeleton is drawn by this one element, so
 * `aria-hidden` is stated once here instead of being remembered at each of the
 * several hundred call sites. A shape that leaked into the accessibility tree
 * would be announced as an empty, meaningless node.
 */
export function SkeletonShape({ className }: { className: string }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} />;
}

/**
 * The frame shared by all six route-level fallbacks.
 *
 * It reproduces the real route's own `<main>` — the same padding, the same
 * container width — for two reasons: the skip link targets `#main-content` and
 * has to keep landing somewhere throughout loading, and a fallback with
 * different geometry would visibly shift the page the moment real content
 * replaced it.
 */
export function RouteSkeleton({
  label,
  mainClassName,
  containerClassName,
  children,
}: {
  label: string;
  mainClassName: string;
  containerClassName: string;
  children: React.ReactNode;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      aria-busy="true"
      data-testid="route-skeleton"
      className={mainClassName}
    >
      <SkeletonAnnouncement message={label} />
      <div className={containerClassName}>{children}</div>
    </main>
  );
}
