import { getFormatLocale } from "@/lib/format";

/**
 * The locale every v2 number is written in: the user's preference (Preferences, language and region), else en-US so the
 * figures are the same in tests and on any browser. The preference reaches lib/format through lib/preferences.
 */
export function v2Locale(): string {
  const chosen = getFormatLocale();
  if (!chosen) return "en-US";
  try {
    return Intl.NumberFormat.supportedLocalesOf(chosen).length > 0 ? chosen : "en-US";
  } catch {
    return "en-US";
  }
}

const cache = new Map<string, Intl.NumberFormat>();

/** A number with a fixed count of decimals in the chosen locale ("71.8" in en-US, "71,8" in de-DE). */
export function fixed(n: number, digits: number): string {
  const key = `${v2Locale()}|${digits}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(v2Locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
    cache.set(key, f);
  }
  return f.format(n);
}

/** A whole number with the locale's thousands separator. */
export function whole(n: number): string {
  return n.toLocaleString(v2Locale(), { maximumFractionDigits: 0 });
}
