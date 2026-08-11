import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  ABSOLUTE_SESSION_SECONDS,
  RECENT_CONFIRMATION_COOKIE,
  RECOVERY_FLOW_COOKIE,
  SESSION_START_COOKIE,
  verifyState,
} from "@/lib/auth/session-state";

const protectedPaths = ["/dashboard", "/settings"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const needsAuth = protectedPaths.some(
    (path) =>
      request.nextUrl.pathname === path ||
      request.nextUrl.pathname.startsWith(`${path}/`),
  );
  if (!user && needsAuth) return signInRedirect(request, response, true);

  if (
    user &&
    !verifyState(
      request.cookies.get(SESSION_START_COOKIE)?.value,
      user.id,
      "session",
      ABSOLUTE_SESSION_SECONDS,
    )
  ) {
    await supabase.auth.signOut();
    return signInRedirect(request, response, false);
  }
  if (user && needsAuth) {
    const { data: membership } = await supabase
      .from("workspace_memberships")
      .select("id")
      .eq("profile_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) {
      await supabase.auth.signOut();
      return signInRedirect(request, response, false);
    }
  }
  return response;
}

function signInRedirect(
  request: NextRequest,
  authResponse: NextResponse,
  preserveNext: boolean,
) {
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  if (preserveNext)
    url.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
  const redirectResponse = NextResponse.redirect(url);
  for (const cookie of authResponse.cookies.getAll())
    redirectResponse.cookies.set(cookie);
  redirectResponse.cookies.delete(SESSION_START_COOKIE);
  redirectResponse.cookies.delete(RECOVERY_FLOW_COOKIE);
  redirectResponse.cookies.delete(RECENT_CONFIRMATION_COOKIE);
  return redirectResponse;
}

export const config = { matcher: ["/dashboard/:path*", "/settings/:path*"] };
