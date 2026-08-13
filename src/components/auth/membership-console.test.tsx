import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  confirmPassword: vi.fn(),
  createInvitation: vi.fn(),
  deleteAccount: vi.fn(),
  deleteWorkspace: vi.fn(),
  leaveWorkspace: vi.fn(),
  removeMember: vi.fn(),
  revokeInvitation: vi.fn(),
  transferOwnership: vi.fn(),
}));

vi.mock("@/lib/auth/actions", () => actions);

import { MembershipConsole } from "./membership-console";

const props = {
  isOwner: true,
  members: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      profile_id: "10000000-0000-4000-8000-000000000001",
      role: "owner",
      display_name: "Family Owner",
    },
  ],
  invitations: [],
  workspaceName: "Morgan Household",
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of Object.values(actions))
    action.mockResolvedValue({ status: "success", message: "Complete." });
});

describe("GH-12 membership danger zone", () => {
  it("FE-002 exposes exact account and workspace confirmations and keeps invalid destructive input usable", () => {
    render(<MembershipConsole {...props} />);

    const accountPhrase = screen.getByTestId("account-deletion-confirmation");
    const accountDelete = screen.getByTestId("delete-account");
    const workspaceName = screen.getByLabelText(
      /type.*morgan household.*delete/i,
    );
    const acknowledgement = screen.getByTestId(
      "workspace-deletion-acknowledgement",
    );
    const workspaceDelete = screen.getByTestId("delete-workspace");

    expect(accountPhrase).toHaveAttribute("name", "accountConfirmation");
    expect(accountPhrase).toHaveAccessibleName(
      /delete my account|confirmation/i,
    );
    expect(accountDelete).toBeDisabled();
    fireEvent.change(accountPhrase, { target: { value: "delete my account" } });
    expect(accountDelete).toBeDisabled();
    fireEvent.change(accountPhrase, {
      target: { value: "DELETE MY ACCOUNT" },
    });
    expect(accountDelete).toBeEnabled();

    expect(workspaceName).toHaveAttribute("name", "workspaceName");
    expect(acknowledgement).toHaveAttribute(
      "name",
      "irreversibleAcknowledgement",
    );
    expect(workspaceDelete).toBeDisabled();
    fireEvent.change(workspaceName, {
      target: { value: "Morgan Household" },
    });
    expect(workspaceDelete).toBeDisabled();
    fireEvent.click(acknowledgement);
    expect(workspaceDelete).toBeEnabled();
  });

  it("FE-003 explains Plaid-first retry semantics, notification, irreversibility, and the Supabase-admin backup boundary", () => {
    render(<MembershipConsole {...props} />);

    const dangerZone = screen.getByTestId("data-lifecycle-danger-zone");
    expect(dangerZone).toHaveTextContent(/plaid/i);
    expect(dangerZone).toHaveTextContent(/revoke|disconnect/i);
    expect(dangerZone).toHaveTextContent(/retry/i);
    expect(dangerZone).toHaveTextContent(/notify|email/i);
    expect(dangerZone).toHaveTextContent(/irreversible|permanent/i);
    expect(dangerZone).toHaveTextContent(/supabase/i);
    expect(dangerZone).toHaveTextContent(/administrator|admin/i);
    expect(dangerZone).toHaveTextContent(/backup|restore/i);
  });

  it("FE-004 announces unresolved revocation as retryable, preserves the form, and does not expose secrets", async () => {
    actions.deleteAccount.mockResolvedValueOnce({
      status: "error",
      message:
        "Bank disconnection could not be confirmed. Retry before deleting your account.",
      data: {
        unresolvedPlaidItemIds: ["40000000-0000-4000-8000-000000000001"],
      },
    });
    render(<MembershipConsole {...props} />);

    const phrase = screen.getByTestId("account-deletion-confirmation");
    fireEvent.change(phrase, { target: { value: "DELETE MY ACCOUNT" } });
    fireEvent.submit(screen.getByTestId("delete-account").closest("form")!);

    const feedback = await screen.findByRole("status");
    expect(feedback).toHaveTextContent(/could not be confirmed.*retry/i);
    expect(feedback).not.toHaveTextContent(
      /access[_ -]?token|smtp|secret|recipient/i,
    );
    await waitFor(() =>
      expect(screen.getByTestId("delete-account")).toBeEnabled(),
    );
    expect(phrase).toHaveValue("DELETE MY ACCOUNT");
  });

  it("FE-003 hides whole-workspace deletion from non-owners while retaining account deletion", () => {
    render(<MembershipConsole {...props} isOwner={false} />);

    expect(screen.getByTestId("delete-account")).toBeInTheDocument();
    expect(screen.queryByTestId("delete-workspace")).not.toBeInTheDocument();
  });
});
