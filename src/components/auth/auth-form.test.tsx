import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthForm } from "./auth-form";

const idleState = { status: "idle" as const };

describe("AuthForm", () => {
  it("FE-001 exposes labelled setup controls and the exact form and submit test IDs", () => {
    render(
      <AuthForm
        action={vi.fn()}
        initialState={idleState}
        submitLabel="Create family workspace"
        submitTestId="setup-submit"
      >
        <label htmlFor="display-name">Display name</label>
        <input id="display-name" name="displayName" />
      </AuthForm>,
    );

    expect(screen.getByTestId("auth-form").tagName).toBe("FORM");
    expect(screen.getByLabelText("Display name")).toHaveAttribute(
      "name",
      "displayName",
    );
    expect(screen.getByTestId("setup-submit")).toHaveAccessibleName(
      "Create family workspace",
    );
  });

  it("FE-002 associates field errors with their input and announces form errors", () => {
    render(
      <AuthForm
        action={vi.fn()}
        initialState={{
          status: "error",
          message: "We could not complete that request.",
          fieldErrors: { email: ["Enter a valid email address."] },
        }}
        submitLabel="Continue"
        submitTestId="recovery-submit"
      >
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" />
      </AuthForm>,
    );

    const input = screen.getByLabelText("Email");
    const fieldError = screen.getByText("Enter a valid email address.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(fieldError.id);
    expect(screen.getByRole("status")).toHaveTextContent(
      "We could not complete that request.",
    );
  });

  it("FE-002 prevents duplicate submission while the action is pending", () => {
    render(
      <AuthForm
        action={vi.fn(() => new Promise(() => undefined))}
        initialState={idleState}
        pendingLabel="Signing in..."
        submitLabel="Sign in"
        submitTestId="sign-in-submit"
      >
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" />
      </AuthForm>,
    );

    const form = screen.getByTestId("auth-form");
    fireEvent.submit(form);
    const submit = screen.getByTestId("sign-in-submit");
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent("Signing in...");
  });

  it("FE-007 preserves native keyboard submission and visible focusable controls", () => {
    render(
      <AuthForm
        action={vi.fn()}
        initialState={idleState}
        submitLabel="Accept invitation"
        submitTestId="invite-accept-submit"
      >
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" />
      </AuthForm>,
    );

    const password = screen.getByLabelText("Password");
    password.focus();
    expect(password).toHaveFocus();
    expect(screen.getByTestId("invite-accept-submit")).toHaveAttribute(
      "type",
      "submit",
    );
  });
});
