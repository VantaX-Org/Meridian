/**
 * Browser features that exist only on a secure origin (HTTPS or localhost). Meridian is often reached over plain
 * http://<host>, where `crypto.randomUUID` and `navigator.clipboard` are undefined: call these helpers, never the
 * APIs directly (lib/__tests__/browser.test.ts keeps it that way).
 */

/** A unique id for a row that lives only in the page (a draft grant, a list key). */
export function localId(): string {
  const c = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Copies text; true when it was copied. Over plain HTTP it falls back to a hidden textarea and the copy command. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused (no permission, not focused): try the fallback below
  }
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
