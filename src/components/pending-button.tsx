import type { ButtonHTMLAttributes, ReactNode } from "react";

export type PendingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending: boolean;
  pendingLabel: ReactNode;
};

export function PendingButton({
  pending,
  pendingLabel,
  children,
  disabled,
  className,
  ...props
}: PendingButtonProps) {
  return (
    <>
      <button
        {...props}
        disabled={disabled || pending}
        aria-busy={pending ? "true" : undefined}
        data-pending={pending ? "true" : "false"}
        className={className}
      >
        <span className="pending-button-content">
          <span
            className="pending-button-label"
            data-visible={pending ? "false" : "true"}
            aria-hidden={pending}
          >
            {children}
          </span>
          <span
            className="pending-button-label pending-button-progress"
            data-visible={pending ? "true" : "false"}
            aria-hidden={!pending}
          >
            {pendingLabel}
            <span className="pending-button-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {pending ? pendingLabel : null}
      </span>
    </>
  );
}
