import { describe, expect, it } from "vitest";

import {
  acceptInvitationSchema,
  confirmPasswordSchema,
  createInvitationSchema,
  deleteWorkspaceSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  setupFamilySchema,
  signInSchema,
} from "./validation";

const strongPassword = "Correct-horse-battery-staple-42";

describe("authentication validation", () => {
  it("API-001/API-002 validates all first-family setup fields at the server boundary", () => {
    expect(
      setupFamilySchema.safeParse({
        displayName: "  Alex Morgan  ",
        workspaceName: "  Morgan household  ",
        email: "  OWNER@Example.test  ",
        password: strongPassword,
      }).success,
    ).toBe(true);

    const invalid = setupFamilySchema.safeParse({
      displayName: "",
      workspaceName: "",
      email: "not-an-email",
      password: "short",
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.flatten().fieldErrors).toMatchObject({
        displayName: expect.any(Array),
        email: expect.any(Array),
        password: expect.any(Array),
        workspaceName: expect.any(Array),
      });
    }
  });

  it("FE-002 accepts valid sign-in credentials and rejects malformed credentials", () => {
    expect(
      signInSchema.safeParse({
        email: "member@example.test",
        password: strongPassword,
        next: "/settings/members",
      }).success,
    ).toBe(true);
    expect(
      signInSchema.safeParse({
        email: "not-an-email",
        password: "",
        next: "/dashboard",
      }).success,
    ).toBe(false);
  });

  it("API-012 validates recovery email without changing the response contract by account existence", () => {
    expect(
      requestPasswordResetSchema.safeParse({ email: "known@example.test" })
        .success,
    ).toBe(true);
    expect(
      requestPasswordResetSchema.safeParse({ email: "absent@example.test" })
        .success,
    ).toBe(true);
    expect(
      requestPasswordResetSchema.safeParse({ email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("FE-002 requires matching strong passwords for recovery", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: strongPassword,
        confirmPassword: strongPassword,
      }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        password: strongPassword,
        confirmPassword: `${strongPassword}-different`,
      }).success,
    ).toBe(false);
  });

  it("API-003/API-006 restricts invitation input to a normalized email and bounded expiry", () => {
    expect(
      createInvitationSchema.safeParse({
        email: "invitee@example.test",
        expiresInHours: "24",
      }).success,
    ).toBe(true);
    expect(
      createInvitationSchema.safeParse({
        email: "not-an-email",
        expiresInHours: "0",
      }).success,
    ).toBe(false);
    expect(
      createInvitationSchema.safeParse({
        email: "invitee@example.test",
        expiresInHours: "8761",
      }).success,
    ).toBe(false);
  });

  it("API-004/API-005 requires an opaque invite token, display name, and strong password", () => {
    const token = "a".repeat(43);
    expect(
      acceptInvitationSchema.safeParse({
        token,
        displayName: "Taylor",
        password: strongPassword,
      }).success,
    ).toBe(true);
    expect(
      acceptInvitationSchema.safeParse({
        token: "guessable",
        displayName: "",
        password: "short",
      }).success,
    ).toBe(false);
  });

  it("API-010 requires a non-empty password for recent confirmation", () => {
    expect(
      confirmPasswordSchema.safeParse({ password: strongPassword }).success,
    ).toBe(true);
    expect(confirmPasswordSchema.safeParse({ password: "" }).success).toBe(
      false,
    );
  });

  it("deleteWorkspace requires a name and irreversible acknowledgement", () => {
    expect(
      deleteWorkspaceSchema.safeParse({
        workspaceName: "Morgan household",
        irreversibleAcknowledgement: "on",
      }).success,
    ).toBe(true);
    expect(
      deleteWorkspaceSchema.safeParse({
        workspaceName: "",
        irreversibleAcknowledgement: "on",
      }).success,
    ).toBe(false);
    expect(
      deleteWorkspaceSchema.safeParse({ workspaceName: "Morgan household" })
        .success,
    ).toBe(false);
  });
});
