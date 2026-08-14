import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  establishRecoveryFlow,
  verifyRecoveryCallbackState,
} from "@/lib/auth/session-state";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const allowedDestinations = new Set(["/dashboard", "/reset-password"]);
const confirmationFailed = "/sign-in?message=confirmation-failed";

function destination(value: string | null) {
  return value && allowedDestinations.has(value) ? value : "/dashboard";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // A denial is indistinguishable from a bad link: the callback must not
  // report that this address was the one being probed.
  const verdict = await consumeRateLimit(
    "auth_callback",
    rateLimitSubject(request.headers),
  );
  if (!verdict.allowed)
    return NextResponse.redirect(new URL(confirmationFailed, url.origin));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createSupabaseServerClient();
  let error: Error | null = null;

  if (code) ({ error } = await supabase.auth.exchangeCodeForSession(code));
  else if (tokenHash && type)
    ({ error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    }));
  else error = new Error("missing confirmation code");

  let target = confirmationFailed;
  if (!error) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) target = confirmationFailed;
    else if (
      type === "recovery" &&
      verifyRecoveryCallbackState(url.searchParams.get("state"), user.email)
    ) {
      await establishRecoveryFlow(user.id);
      target = "/reset-password";
    } else if (type === "recovery") {
      target = confirmationFailed;
    } else {
      target = destination(url.searchParams.get("next"));
    }
  }
  return NextResponse.redirect(new URL(target, url.origin));
}
