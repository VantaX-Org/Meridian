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

/** "3 hours ago" in the chosen locale ("vor 3 Stunden", "3 時間前"), through Intl.RelativeTimeFormat. */
export function relTime(iso: string, now: number = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000;
  if (!Number.isFinite(diff)) return "—";
  const rtf = new Intl.RelativeTimeFormat(v2Locale(), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(0, "minute");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), "day");
  if (abs < 86_400 * 365) return rtf.format(Math.round(diff / (86_400 * 30)), "month");
  return rtf.format(Math.round(diff / (86_400 * 365)), "year");
}

/** An amount of money in the chosen locale, with the currency the tenant set. */
export function money(n: number, currency: string, digits = 0): string {
  try {
    return new Intl.NumberFormat(v2Locale(), { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${whole(n)} ${currency}`;
  }
}

/**
 * A SAP key as SAP users read it: a purely numeric key loses its leading zeros (the ALPHA conversion exit,
 * "000000000000000232" reads "232"); a key with letters stays as it is. The full key stays in the title and the copy.
 */
export function alphaOut(key: string): string {
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key;
}
