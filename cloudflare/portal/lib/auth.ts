import { NextRequest, NextResponse } from "next/server";

/**
 * Cloudflare Access injects `cf-access-authenticated-user-email` on every
 * request after the user authenticates. This is the only identity signal
 * needed for an admin-only portal.
 *
 * In local development (NODE_ENV=development) the header is absent, so we
 * fall back to DEV_ADMIN_EMAIL or a placeholder so the app still renders.
 */
export function getAdminEmailFromRequest(req: NextRequest): string | null {
  const email = req.headers.get("cf-access-authenticated-user-email");
  if (!email && process.env.NODE_ENV === "development") {
    return process.env.DEV_ADMIN_EMAIL ?? "dev@meridian.local";
  }
  return email;
}

/**
 * API route guard. Returns a 401 response if the request is not from an
 * authenticated Cloudflare Access session, or null if access is allowed.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const email = getAdminEmailFromRequest(req);
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
