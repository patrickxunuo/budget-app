export type AuthActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  data?: Record<string, unknown>;
};
export const idleAuthState: AuthActionState = { status: "idle" };
