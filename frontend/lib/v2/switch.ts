/**
 * The interface switch. `mn_ui=v2` says this browser prefers the new interface. In step 0 nothing reads it to
 * redirect: /v2 is reachable whatever the cookie says, and the current interface is untouched. Preferences sets it,
 * /v2 sets it, and "Back to the current interface" clears it.
 */
export const UI_COOKIE = "mn_ui";
export const UI_V2 = "v2";
const YEAR = 60 * 60 * 24 * 365;

export function readUiCookie(source: string = typeof document === "undefined" ? "" : document.cookie): string | null {
  const hit = source.split(/;\s*/).find((c) => c.startsWith(`${UI_COOKIE}=`));
  const value = hit ? hit.slice(UI_COOKIE.length + 1) : "";
  return value || null;
}

/** Chooses the interface for this browser. Null clears the choice. */
export function setUiCookie(value: typeof UI_V2 | null): void {
  if (typeof document === "undefined") return;
  document.cookie = value ? `${UI_COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=${YEAR}` : `${UI_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
}
