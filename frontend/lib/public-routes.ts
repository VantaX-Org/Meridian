/** Pages a signed-out visitor may open. The proxy lets them through, and a 401 on one never sends the visitor to sign-in. */
export const PUBLIC_ROUTES = ["/sign-in", "/sign-up", "/login", "/accept-invite", "/forgot-password", "/reset-password",
  "/licence-error", "/api", "/health", "/status", "/share"];

export const isPublicRoute = (pathname: string): boolean =>
  PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"));
