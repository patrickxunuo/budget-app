import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env/server";

export const SESSION_START_COOKIE = "budget-session-start";
export const RECOVERY_FLOW_COOKIE = "budget-recovery-flow";
export const RECENT_CONFIRMATION_COOKIE = "recent-password-confirmed";
export const ABSOLUTE_SESSION_SECONDS = 30 * 24 * 60 * 60;
const RECOVERY_FLOW_SECONDS = 10 * 60;

type StatePurpose =
  "session" | "recovery" | "confirmation" | "recovery-callback";

function signature(payload: string, purpose: StatePurpose) {
  return createHmac("sha256", getServerEnv().SUPABASE_SERVICE_ROLE_KEY)
    .update(`${purpose}:${payload}`)
    .digest("base64url");
}

function encode(userId: string, issuedAt: number, purpose: StatePurpose) {
  const payload = `${userId}.${issuedAt}`;
  return `${payload}.${signature(payload, purpose)}`;
}

export function verifyState(
  value: string | undefined,
  userId: string,
  purpose: StatePurpose,
  maxAgeSeconds: number,
) {
  if (!value) return false;
  const [tokenUserId, issuedAtText, suppliedSignature, ...rest] =
    value.split(".");
  if (
    rest.length ||
    tokenUserId !== userId ||
    !issuedAtText ||
    !suppliedSignature
  )
    return false;
  const issuedAt = Number(issuedAtText);
  if (!Number.isSafeInteger(issuedAt)) return false;
  const age = Math.floor(Date.now() / 1000) - issuedAt;
  if (age < 0 || age > maxAgeSeconds) return false;
  const expected = Buffer.from(
    signature(`${tokenUserId}.${issuedAtText}`, purpose),
  );
  const supplied = Buffer.from(suppliedSignature);
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

function options(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/",
  };
}

export function createRecoveryCallbackState(email: string) {
  const payload = Buffer.from(
    JSON.stringify({
      email: email.toLowerCase(),
      issuedAt: Math.floor(Date.now() / 1000),
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload, "recovery-callback")}`;
}

export function verifyRecoveryCallbackState(
  value: string | null,
  email: string | undefined,
) {
  if (!value || !email) return false;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return false;
  const payload = value.slice(0, separator);
  const supplied = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(signature(payload, "recovery-callback"));
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return false;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      email?: string;
      issuedAt?: number;
    };
    const age = Math.floor(Date.now() / 1000) - (parsed.issuedAt ?? 0);
    return (
      parsed.email === email.toLowerCase() &&
      age >= 0 &&
      age <= RECOVERY_FLOW_SECONDS
    );
  } catch {
    return false;
  }
}
export async function establishSessionStart(userId: string) {
  const store = await cookies();
  store.set(
    SESSION_START_COOKIE,
    encode(userId, Math.floor(Date.now() / 1000), "session"),
    options(ABSOLUTE_SESSION_SECONDS),
  );
}

export async function establishRecoveryFlow(userId: string) {
  const store = await cookies();
  store.set(
    RECOVERY_FLOW_COOKIE,
    encode(userId, Math.floor(Date.now() / 1000), "recovery"),
    options(RECOVERY_FLOW_SECONDS),
  );
}

export async function consumeRecoveryFlow(userId: string) {
  const store = await cookies();
  const valid = verifyState(
    store.get(RECOVERY_FLOW_COOKIE)?.value,
    userId,
    "recovery",
    RECOVERY_FLOW_SECONDS,
  );
  store.delete(RECOVERY_FLOW_COOKIE);
  return valid;
}

export async function markRecentConfirmationCookie(userId: string) {
  const store = await cookies();
  store.set(
    RECENT_CONFIRMATION_COOKIE,
    encode(userId, Math.floor(Date.now() / 1000), "confirmation"),
    options(15 * 60),
  );
}

export async function clearApplicationAuthCookies() {
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith("sb-")) store.delete(cookie.name);
  }
  store.delete(SESSION_START_COOKIE);
  store.delete(RECOVERY_FLOW_COOKIE);
  store.delete(RECENT_CONFIRMATION_COOKIE);
}
