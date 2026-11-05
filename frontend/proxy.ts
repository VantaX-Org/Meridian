import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildCsp } from "./lib/csp";

/**
 * Signed-out users never receive the app shell. The bearer token lives in
 * localStorage (unreadable here), so the auth context sets a plain marker
 * cookie on login; every API call still carries and verifies the real token.
 */
const PUBLIC = ["/sign-in", "/sign-up", "/login", "/accept-invite", "/forgot-password", "/reset-password",
  "/licence-error", "/api", "/health", "/status"];

/** Continue to the page with a fresh nonce: the request header lets the layout and Next read it, the response header enforces it. */
function withCsp(req: NextRequest, extra?: (res: NextResponse) => void) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  extra?.(res);
  return res;
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/")) || req.cookies.has("mn_session")) {
    return withCsp(req);
  }
  // Local convenience only: `next dev` with MERIDIAN_DEV_AUTOLOGIN=1 skips the sign-in redirect.
  if (process.env.NODE_ENV === "development" && process.env.MERIDIAN_DEV_AUTOLOGIN === "1") {
    return withCsp(req, (res) => res.cookies.set("mn_session", "1", { path: "/", sameSite: "lax", maxAge: 2592000 }));
  }
  const url = req.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
