import { z } from "zod";

const displayName = z.string().trim().min(1, "Enter your name").max(100);
const workspaceName = z
  .string()
  .trim()
  .min(1, "Enter the workspace name")
  .max(100);
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address");
const password = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128)
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/[0-9]/, "Add a number");
const uuid = z.string().uuid("Invalid selection");

export const setupFamilySchema = z.object({
  displayName,
  workspaceName,
  email,
  password,
});
export const signInSchema = z.object({
  email,
  password: z.string().min(1),
  next: z
    .string()
    .optional()
    .refine(
      (value) =>
        !value ||
        (value.startsWith("/") &&
          !value.startsWith("//") &&
          !value.includes("\\\\")),
      "Invalid return path",
    ),
});
export const requestPasswordResetSchema = z.object({ email });
export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match",
  });
export const createInvitationSchema = z.object({
  email,
  expiresInHours: z.coerce.number().int().min(1).max(168),
});
export const acceptInvitationSchema = z.object({
  token: z.string().min(32),
  displayName,
  password,
});
export const confirmationPasswordSchema = z.object({
  password: z.string().min(1),
});
export const confirmPasswordSchema = confirmationPasswordSchema;
export const deleteWorkspaceSchema = z.object({ workspaceName });
export const membershipSchema = z.object({ membershipId: uuid });

export function formValues(formData: FormData) {
  return Object.fromEntries(formData.entries());
}
