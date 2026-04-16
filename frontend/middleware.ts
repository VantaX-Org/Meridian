import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Local auth mode only — auth guard is handled by AuthGuard in dashboard layout.
// Route protection (redirect to /sign-in) happens client-side via AuthGuard.
export default function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
