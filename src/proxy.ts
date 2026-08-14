import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  ABSOLUTE_SESSION_SECONDS,
  RECENT_CONFIRMATION_COOKIE,
  RECOVERY_FLOW_COOKIE,
  SESSION_START_COOKIE,
  verifyState,
} from "@/lib/auth/session-state";
import { isTrustedRequestOrigin } from "@/lib/security/origin";

const protectedPaths = ["/dashboard", "/settings"];

export async function proxy(request: NextRequest) {
  // The origin gate runs before anything else so a forged cross-site write is
  // rejected without a Supabase round trip. `getServerEnv()` is `server-only`
  // and throws on any missing server variable, which would take the proxy down
  // for every route, so APP_URL is read from `process.env` directly and falls
  // back to the request's own origin rather than hard-failing.
  const allowedOrigin = process.env.APP_URL || request.nextUrl.origin;
  if (!isTrustedRequestOrigin(request, allowedOrigin))
    return NextResponse.json(
      {
        code: "invalid_origin",
        message: "This request could not be verified.",
      },
      { status: 403 },
    );

  const needsAuth = protectedPaths.some(
    (path) =>
      request.nextUrl.pathname === path ||
      request.nextUrl.pathname.startsWith(`${path}/`),
  );
  // The matcher now spans API and auth routes purely so the gate above can see
  // their writes. Session and membership enforcement stays scoped to the
  // originally protected paths, or an unauthenticated API call would start
  // being redirected to the sign-in page.
  if (!needsAuth) return NextResponse.next({ request });

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
  if (!user) return signInRedirect(request, response, true);

  if (
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

// Route Handlers get no CSRF protection from the framework, so `/api` and
// `/auth` are matched to put the origin gate in front of every API write.
//
// The public auth pages are matched for the same reason at a second layer.
// Server Functions are POSTs to the route that hosts them, and Next already
// compares their Origin against the Host — but that protection is a framework
// default that `serverActions.allowedOrigins` can widen, so the pages hosting
// the credential actions carry an explicit gate that does not depend on it.
// `/settings/:path*` already covers the membership console's actions.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/api/:path*",
    "/auth/:path*",
    "/sign-in",
    "/setup",
    "/forgot-password",
    "/reset-password",
    "/invite/:path*",
  ],
};
