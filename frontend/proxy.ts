import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Signed-out users never receive the app shell. The session is an httponly cookie
 * the API sets, so the auth context sets a plain marker cookie on login; every API
 * call still carries and verifies the real session.
 */
const PUBLIC = ["/sign-in", "/sign-up", "/login", "/accept-invite", "/forgot-password", "/reset-password",
  "/licence-error", "/api", "/health", "/status"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/")) || req.cookies.has("mn_session")) {
    return NextResponse.next();
  }
  // Local convenience only: `next dev` with MERIDIAN_DEV_AUTOLOGIN=1 skips the sign-in redirect.
  if (process.env.NODE_ENV === "development" && process.env.MERIDIAN_DEV_AUTOLOGIN === "1") {
    const res = NextResponse.next();
    res.cookies.set("mn_session", "1", { path: "/", sameSite: "lax", maxAge: 2592000 });
    return res;
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
