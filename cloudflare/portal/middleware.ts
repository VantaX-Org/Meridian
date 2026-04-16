import { NextRequest, NextResponse } from "next/server";

/**
 * Cloudflare Access blocks unauthenticated requests before they reach this
 * app, so this middleware is a defence-in-depth safety net only.
 */
export function middleware(request: NextRequest) {
  const email = request.headers.get("cf-access-authenticated-user-email");
  if (!email && process.env.NODE_ENV !== "development") {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
