/**
 * The Content-Security-Policy for every HTML page. proxy.ts sets it on each response, so it reaches the browser
 * the same way behind nginx, the helm ingress or a direct port 3000: all three send HTML routes to this server.
 *
 * Scripts are allowed only with the per-request nonce (Next stamps it on its own bootstrap scripts; the root layout
 * stamps the theme script), and 'strict-dynamic' lets those scripts load their chunks. Styles keep 'unsafe-inline'
 * because React `style={...}` props render as inline style attributes, which only that keyword can allow; that
 * leaves style injection possible and is the known limit (docs/diligence/roadmap-and-debt.md, D-13).
 * Everything else is same-origin: the API, SSE, tenant logos and help videos all live under /api on this origin.
 * blob: and data: images cover the logo preview and inline icons; downloads are blob navigations, which no
 * directive governs. An SSO sign-in is a top-level navigation, not a form post or fetch, so it needs no entry.
 */
export function buildCsp(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    // Dev builds run React and the refresh runtime through eval; production must not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self'",
    "connect-src 'self'" + (dev ? " ws:" : ""),
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
