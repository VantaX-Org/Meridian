/** True for a path inside the app (`/`, `/work?...`), false for `/api/...`, a protocol-relative or an outside URL. */
export function isAppPath(href: string): boolean {
  return /^\/(?![/\\])/.test(href) && !/^\/api(?:[/?#]|$)/.test(href);
}
