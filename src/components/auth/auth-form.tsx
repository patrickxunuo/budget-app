"use client";
import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  useActionState,
} from "react";
import type { AuthActionState } from "@/lib/auth/types";
type Action = (
  state: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;
type ActionInput = (
  state: AuthActionState,
  formData: FormData,
) => Promise<unknown>;
type FieldElementProps = {
  name: string;
  fieldErrors?: string[];
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};
export function AuthForm({
  action,
  initialState,
  submitLabel,
  submitTestId,
  pendingLabel = "Working…",
  children,
}: Readonly<{
  action: ActionInput;
  initialState: AuthActionState;
  submitLabel: string;
  submitTestId?: string;
  pendingLabel?: string;
  children: React.ReactNode;
}>) {
  const [state, formAction, pending] = useActionState(
    action as Action,
    initialState,
  );
  const fields = Children.map(children, (child) => {
    if (!isValidElement<FieldElementProps>(child) || !child.props.name) {
      return child;
    }

    const errors = state.fieldErrors?.[child.props.name];
    if (typeof child.type !== "string") {
      return cloneElement(child, { fieldErrors: errors });
    }

    const errorId = `${child.props.name}-error`;
    return (
      <Fragment key={child.key ?? child.props.name}>
        {cloneElement(child, {
          "aria-describedby": errors?.length ? errorId : undefined,
          "aria-invalid": errors?.length ? true : undefined,
        })}
        {errors?.map((message) => (
          <span id={errorId} key={message} className="text-alert block text-xs">
            {message}
          </span>
        ))}
      </Fragment>
    );
  });
  return (
    <form
      action={formAction}
      data-testid="auth-form"
      className="space-y-5"
      noValidate
    >
      {fields}
      <div
        aria-live="polite"
        role="status"
        className={`min-h-6 text-sm ${state.status === "error" ? "text-alert" : "text-brand"}`}
      >
        {state.message}
      </div>
      <button
        type="submit"
        data-testid={submitTestId}
        disabled={pending}
        className="bg-brand hover:bg-brand-strong focus-visible:outline-brand text-on-accent flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = true,
  defaultValue,
  fieldErrors,
}: Readonly<{
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  fieldErrors?: string[];
}>) {
  const errorId = `${name}-error`;
  return (
    <label className="text-ink block text-sm font-semibold">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={fieldErrors?.length ? true : undefined}
        aria-describedby={fieldErrors?.length ? errorId : undefined}
        className="border-line bg-panel text-ink placeholder:text-muted/60 focus:border-brand focus:ring-brand/20 mt-2 min-h-12 w-full rounded-xl border px-4 transition outline-none focus:ring-4"
      />
      {fieldErrors?.map((message) => (
        <span
          id={errorId}
          key={message}
          className="text-alert mt-1 block text-xs"
        >
          {message}
        </span>
      ))}
    </label>
  );
}
