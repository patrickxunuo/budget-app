type LedgerMarkProps = {
  className?: string;
};

export function LedgerMark({ className = "" }: LedgerMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-grid size-9 shrink-0 place-items-center overflow-hidden rounded-[0.65rem] border border-current ${className}`}
    >
      <span className="absolute inset-y-1.5 left-[0.62rem] w-px bg-current opacity-45" />
      <span className="absolute inset-x-1.5 top-[0.72rem] h-px bg-current opacity-45" />
      <span className="absolute inset-x-1.5 bottom-[0.72rem] h-px bg-current opacity-45" />
      <span className="absolute right-[0.58rem] size-1.5 rounded-full bg-current" />
    </span>
  );
}
