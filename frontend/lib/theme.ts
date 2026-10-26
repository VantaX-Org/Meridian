/**
 * The one theme default and the first-paint script built from it. Type-only imports, so the server root
 * layout, the client global-error page, hooks/use-theme.ts and lib/preferences.ts can all share it.
 */
import type { Theme } from "./preferences";

/** The theme a user who never chose one sees: the light Canvas (DESIGN.md, section 1). */
export const DEFAULT_THEME: Theme = "light";

/** The whole preferences document lib/preferences.ts writes. */
export const PREFS_STORAGE_KEY = "meridian:prefs";
/** The per-key mirror lib/preferences.ts writes beside the document. */
export const THEME_STORAGE_KEY = "meridian:theme";
/** Written by builds before the rename; read as a last fallback. */
export const LEGACY_THEME_STORAGE_KEY = "aurora:theme";

/**
 * Sets data-theme on <html> before first paint from the same keys lib/preferences.ts reads (the document's
 * theme, then the mirror, then the legacy key), falling back to DEFAULT_THEME. "system" is resolved against
 * prefers-color-scheme so dark users never flash light.
 */
export function themeBootScript(): string {
  const prefs = JSON.stringify(PREFS_STORAGE_KEY);
  const mirror = JSON.stringify(THEME_STORAGE_KEY);
  const legacy = JSON.stringify(LEGACY_THEME_STORAGE_KEY);
  const fallback = JSON.stringify(DEFAULT_THEME);
  return (
    `try{var s=localStorage,t=null;try{var d=JSON.parse(s.getItem(${prefs})||"{}");if(d&&typeof d.theme==="string")t=d.theme}catch(e){}` +
    `t=t||s.getItem(${mirror})||s.getItem(${legacy})||${fallback};` +
    `if(t!=="dark"&&t!=="light"&&t!=="system")t=${fallback};` +
    `if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";` +
    `document.documentElement.dataset.theme=t}catch(e){}`
  );
}
