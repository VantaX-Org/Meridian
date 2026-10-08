import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Signed-out users never receive the app shell. The bearer token lives in
 * localStorage (unreadable here), so the auth context sets a plain marker
 * cookie on login; every API call still carries and verifies the real token.
 */
const PUBLIC = ["/sign-in", "/sign-up", "/login", "/accept-invite", "/forgot-password", "/reset-password",
  "/licence-error", "/api", "/health"];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // The component gallery is dev-only; the page itself 404s via notFound(),
  // but that still ships the route's JS in production. Stop it at the edge too.
  if (pathname === "/design" && process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/")) || req.cookies.has("mn_session")) {
    return NextResponse.next();
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
