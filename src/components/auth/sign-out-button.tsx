"use client";
import { signOut } from "@/lib/auth/actions";
export function SignOutButton() {
  const submit = async () => {
    await signOut();
  };
  return (
    <form action={submit}>
      <button className="text-muted hover:text-alert focus-visible:outline-brand rounded-lg px-3 py-2 text-xs font-semibold focus-visible:outline-2">
        Sign out
      </button>
    </form>
  );
}
